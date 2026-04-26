// Reflections log CRUD. GET supports ?kind=&limit= filters. POST creates a new
// reflection — kind defaults to 'observation'.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_KINDS = new Set([
  "lesson",
  "regret",
  "realisation",
  "observation",
  "gratitude",
  "other",
]);

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const kind = req.nextUrl.searchParams.get("kind");
  const limitRaw = req.nextUrl.searchParams.get("limit");
  let limit = 60;
  if (limitRaw) {
    const n = Number(limitRaw);
    if (Number.isFinite(n) && n > 0 && n <= 200) limit = Math.round(n);
  }

  let q = supabase
    .from("reflections")
    .select("id, text, kind, tags, created_at")
    .eq("user_id", user.id);
  if (kind && kind !== "all" && VALID_KINDS.has(kind)) {
    q = q.eq("kind", kind);
  }
  q = q.order("created_at", { ascending: false }).limit(limit);
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

  const text = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const kind =
    typeof body.kind === "string" && VALID_KINDS.has(body.kind) ? body.kind : "observation";

  const tags: string[] = Array.isArray(body.tags)
    ? (body.tags as unknown[])
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 12)
    : [];

  const { data, error } = await supabase
    .from("reflections")
    .insert({ user_id: user.id, text, kind, tags })
    .select("id, text, kind, tags, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reflection: data });
}
