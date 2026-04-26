// Ideas inbox CRUD. GET supports ?status=fresh|exploring|shelved|adopted|active|all
// (default 'active' = fresh+exploring). POST creates a new idea.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_KINDS = new Set(["product", "content", "venture", "optimization", "other"]);
const VALID_STATUSES = new Set(["fresh", "exploring", "shelved", "adopted"]);

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const status = (req.nextUrl.searchParams.get("status") ?? "active").toLowerCase();
  let q = supabase
    .from("ideas")
    .select("id, text, kind, status, heat, adopted_to, note, tags, created_at, updated_at")
    .eq("user_id", user.id);
  if (status === "active") {
    q = q.in("status", ["fresh", "exploring"]);
  } else if (status !== "all" && VALID_STATUSES.has(status)) {
    q = q.eq("status", status);
  }
  q = q.order("heat", { ascending: false }).order("created_at", { ascending: false });
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

  const text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const kind = typeof body.kind === "string" && VALID_KINDS.has(body.kind) ? body.kind : "other";
  let heat = 3;
  if (body.heat !== undefined) {
    const n = Number(body.heat);
    if (Number.isFinite(n) && n >= 1 && n <= 5) heat = Math.round(n);
  }
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) || null : null;

  const { data, error } = await supabase
    .from("ideas")
    .insert({ user_id: user.id, text, kind, heat, note })
    .select("id, text, kind, status, heat, adopted_to, note, tags, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ idea: data });
}
