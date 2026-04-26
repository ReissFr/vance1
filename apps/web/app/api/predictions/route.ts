// Predictions CRUD. GET supports ?status=open|resolved|all (default open).
// POST creates a new prediction (no upsert — predictions are point-in-time
// forecasts, never edited via re-save).

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_STATUSES = new Set([
  "open",
  "resolved_yes",
  "resolved_no",
  "withdrawn",
]);

function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return (input as unknown[])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 12);
}

function clampConfidence(input: unknown): number | null {
  if (typeof input !== "number") return null;
  const v = Math.round(input);
  if (v < 1 || v > 99) return null;
  return v;
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const status = (req.nextUrl.searchParams.get("status") ?? "open").toLowerCase();

  let q = supabase
    .from("predictions")
    .select("id, claim, confidence, resolve_by, status, resolved_at, resolved_note, category, tags, created_at, updated_at")
    .eq("user_id", user.id);

  if (status === "open") {
    q = q.eq("status", "open");
  } else if (status === "resolved") {
    q = q.in("status", ["resolved_yes", "resolved_no"]);
  } else if (status !== "all" && VALID_STATUSES.has(status)) {
    q = q.eq("status", status);
  }

  q = q
    .order("status", { ascending: true })
    .order("resolve_by", { ascending: true })
    .limit(500);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const claim = typeof body.claim === "string" ? body.claim.trim().slice(0, 500) : "";
  if (!claim) return NextResponse.json({ error: "claim required" }, { status: 400 });

  const confidence = clampConfidence(body.confidence);
  if (confidence === null) {
    return NextResponse.json(
      { error: "confidence required (integer 1-99)" },
      { status: 400 },
    );
  }

  const resolveBy = typeof body.resolve_by === "string" ? body.resolve_by.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resolveBy)) {
    return NextResponse.json({ error: "resolve_by required (YYYY-MM-DD)" }, { status: 400 });
  }

  const category =
    typeof body.category === "string" ? body.category.trim().slice(0, 60) || null : null;
  const tags = sanitizeTags(body.tags);

  const { data, error } = await supabase
    .from("predictions")
    .insert({
      user_id: user.id,
      claim,
      confidence,
      resolve_by: resolveBy,
      category,
      tags,
    })
    .select("id, claim, confidence, resolve_by, status, category, tags, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prediction: data });
}
