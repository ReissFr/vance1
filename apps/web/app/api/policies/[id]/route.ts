// PATCH supports per-field updates plus { toggle: true } to flip active.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_CATEGORIES = new Set([
  "scheduling",
  "communication",
  "finance",
  "health",
  "relationships",
  "work",
  "general",
]);

function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return (input as unknown[])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 12);
}

function clampPriority(input: unknown): number | undefined {
  if (typeof input !== "number") return undefined;
  const v = Math.round(input);
  if (v < 1) return 1;
  if (v > 5) return 5;
  return v;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.toggle === true) {
    const { data: row } = await supabase
      .from("policies")
      .select("active")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    const cur = (row as { active: boolean }).active;
    const { error } = await supabase
      .from("policies")
      .update({ active: !cur, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, active: !cur });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const t = body.name.trim().slice(0, 80);
    if (!t) return NextResponse.json({ error: "name empty" }, { status: 400 });
    patch.name = t;
  }
  if (typeof body.rule === "string") {
    const t = body.rule.trim().slice(0, 2000);
    if (!t) return NextResponse.json({ error: "rule empty" }, { status: 400 });
    patch.rule = t;
  }
  if (typeof body.category === "string" && VALID_CATEGORIES.has(body.category)) {
    patch.category = body.category;
  }
  const pri = clampPriority(body.priority);
  if (pri !== undefined) patch.priority = pri;
  if (typeof body.active === "boolean") patch.active = body.active;
  if (typeof body.examples === "string") {
    patch.examples = body.examples.trim().slice(0, 2000) || null;
  }
  if (Array.isArray(body.tags)) {
    patch.tags = sanitizeTags(body.tags);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("policies")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("policies")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
