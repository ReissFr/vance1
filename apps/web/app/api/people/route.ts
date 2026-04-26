// People CRUD. GET supports ?q=, ?relation=, ?archived=true|false (default false).
// POST creates a person. last_interaction_at is set by inserting interactions,
// not directly here.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_RELATIONS = new Set([
  "friend",
  "family",
  "team",
  "customer",
  "prospect",
  "investor",
  "founder",
  "mentor",
  "vendor",
  "press",
  "other",
]);

function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return (input as unknown[])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 12);
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q");
  const relation = req.nextUrl.searchParams.get("relation");
  const archived = req.nextUrl.searchParams.get("archived") === "true";

  let query = supabase
    .from("people")
    .select(
      "id, name, relation, importance, email, phone, company, role, notes, tags, last_interaction_at, reconnect_every_days, archived_at, created_at, updated_at",
    )
    .eq("user_id", user.id);

  if (archived) {
    query = query.not("archived_at", "is", null);
  } else {
    query = query.is("archived_at", null);
  }
  if (relation && relation !== "all" && VALID_RELATIONS.has(relation)) {
    query = query.eq("relation", relation);
  }
  if (q && q.trim()) {
    const needle = q.trim().slice(0, 80);
    query = query.or(`name.ilike.%${needle}%,company.ilike.%${needle}%,role.ilike.%${needle}%,email.ilike.%${needle}%,notes.ilike.%${needle}%`);
  }

  query = query
    .order("importance", { ascending: true })
    .order("last_interaction_at", { ascending: false, nullsFirst: false })
    .order("name", { ascending: true })
    .limit(500);

  const { data, error } = await query;
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

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const relation =
    typeof body.relation === "string" && VALID_RELATIONS.has(body.relation) ? body.relation : "other";

  let importance = 2;
  if (body.importance !== undefined) {
    const n = Number(body.importance);
    if (Number.isFinite(n) && n >= 1 && n <= 3) importance = Math.round(n);
  }

  const trimStr = (k: string, max: number): string | null => {
    const v = body[k];
    if (typeof v !== "string") return null;
    const t = v.trim().slice(0, max);
    return t || null;
  };

  let reconnectEvery: number | null = null;
  if (body.reconnect_every_days !== undefined && body.reconnect_every_days !== null) {
    const n = Number(body.reconnect_every_days);
    if (Number.isFinite(n) && n >= 1 && n <= 365) reconnectEvery = Math.round(n);
  }

  const { data, error } = await supabase
    .from("people")
    .insert({
      user_id: user.id,
      name,
      relation,
      importance,
      email: trimStr("email", 200),
      phone: trimStr("phone", 50),
      company: trimStr("company", 200),
      role: trimStr("role", 200),
      notes: trimStr("notes", 4000),
      tags: sanitizeTags(body.tags),
      reconnect_every_days: reconnectEvery,
    })
    .select(
      "id, name, relation, importance, email, phone, company, role, notes, tags, last_interaction_at, reconnect_every_days, created_at, updated_at",
    )
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ person: data });
}
