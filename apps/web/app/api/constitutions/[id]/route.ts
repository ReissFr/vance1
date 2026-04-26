// GET /api/constitutions/[id] — fetch a single version.
// PATCH /api/constitutions/[id] — body { pin?, archive?, restore?, user_note?,
//                                         set_current? }.
// DELETE /api/constitutions/[id] — delete a single version. If deleting the
// current version, the next-most-recent non-archived version is promoted.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await supabase
    .from("constitutions")
    .select("id, version, parent_id, preamble, body, articles, source_counts, diff_summary, is_current, pinned, archived_at, user_note, created_at, updated_at")
    .eq("user_id", user.id)
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ constitution: data });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    pin?: boolean; archive?: boolean; restore?: boolean; user_note?: string; set_current?: boolean;
  };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.pin === "boolean") patch.pinned = body.pin;
  if (body.archive === true) patch.archived_at = new Date().toISOString();
  if (body.restore === true) patch.archived_at = null;
  if (typeof body.user_note === "string") patch.user_note = body.user_note.slice(0, 1200);

  if (body.set_current === true) {
    await supabase
      .from("constitutions")
      .update({ is_current: false, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .neq("id", id);
    patch.is_current = true;
    patch.archived_at = null;
  }

  const { data, error } = await supabase
    .from("constitutions")
    .update(patch)
    .eq("user_id", user.id)
    .eq("id", id)
    .select("id, version, parent_id, preamble, body, articles, source_counts, diff_summary, is_current, pinned, archived_at, user_note, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ constitution: data });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: existing } = await supabase
    .from("constitutions")
    .select("id, is_current")
    .eq("user_id", user.id)
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("constitutions")
    .delete()
    .eq("user_id", user.id)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (existing?.is_current) {
    const { data: next } = await supabase
      .from("constitutions")
      .select("id")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (next?.id) {
      await supabase
        .from("constitutions")
        .update({ is_current: true, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("id", next.id);
    }
  }

  return NextResponse.json({ ok: true });
}
