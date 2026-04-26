// Questions log CRUD. GET supports ?status=open|exploring|answered|dropped|active|all
// (default 'active' = open + exploring). POST creates an open question.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_KINDS = new Set(["strategic", "customer", "technical", "personal", "other"]);
const VALID_STATUSES = new Set(["open", "exploring", "answered", "dropped"]);

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const status = (req.nextUrl.searchParams.get("status") ?? "active").toLowerCase();
  let q = supabase
    .from("questions")
    .select("id, text, kind, status, priority, answer, answered_at, tags, created_at, updated_at")
    .eq("user_id", user.id);
  if (status === "active") {
    q = q.in("status", ["open", "exploring"]);
  } else if (status !== "all" && VALID_STATUSES.has(status)) {
    q = q.eq("status", status);
  }
  q = q.order("priority", { ascending: true }).order("created_at", { ascending: false });
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
  let priority = 2;
  if (body.priority !== undefined) {
    const n = Number(body.priority);
    if (Number.isFinite(n) && n >= 1 && n <= 3) priority = Math.round(n);
  }

  const { data, error } = await supabase
    .from("questions")
    .insert({ user_id: user.id, text, kind, priority })
    .select("id, text, kind, status, priority, answer, answered_at, tags, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ question: data });
}
