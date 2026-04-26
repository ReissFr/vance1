// PATCH/DELETE /api/letters/[id] — pin, archive, edit, or delete a letter (§173).
//
// PATCH body: one of
//   { mode: 'pin' | 'unpin' }
//   { mode: 'archive' | 'restore' }
//   { mode: 'deliver_now' } — for to_future_self letters: deliver early
//   { mode: 'edit', title?, letter_text? }

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_MODES = new Set([
  "pin", "unpin", "archive", "restore", "deliver_now", "edit",
]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  let body: { mode?: unknown; title?: unknown; letter_text?: unknown };
  try { body = (await req.json()) as typeof body; } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const mode = typeof body.mode === "string" ? body.mode : "";
  if (!VALID_MODES.has(mode)) {
    return NextResponse.json({ error: `mode must be one of ${[...VALID_MODES].join("/")}` }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: nowIso };

  if (mode === "pin") patch.pinned = true;
  else if (mode === "unpin") patch.pinned = false;
  else if (mode === "archive") patch.status = "archived";
  else if (mode === "restore") {
    // restore to scheduled if target_date is still in future and direction
    // is to_future_self, else delivered.
    const { data: cur } = await supabase
      .from("letters")
      .select("direction, target_date")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    const todayIso = new Date().toISOString().slice(0, 10);
    if (cur?.direction === "to_future_self" && cur.target_date > todayIso) {
      patch.status = "scheduled";
    } else {
      patch.status = "delivered";
    }
  } else if (mode === "deliver_now") {
    patch.status = "delivered";
    patch.delivered_at = nowIso;
    patch.delivery_channels = { web: true };
  } else if (mode === "edit") {
    if (typeof body.title === "string") {
      const v = body.title.trim();
      if (v.length > 0 && (v.length < 4 || v.length > 120)) {
        return NextResponse.json({ error: "title must be 4-120 chars or empty" }, { status: 400 });
      }
      patch.title = v.length === 0 ? null : v;
    }
    if (typeof body.letter_text === "string") {
      const v = body.letter_text.trim();
      if (v.length < 50 || v.length > 8000) {
        return NextResponse.json({ error: "letter_text must be 50-8000 chars" }, { status: 400 });
      }
      patch.letter_text = v;
    }
    if (Object.keys(patch).length === 1) {
      return NextResponse.json({ error: "edit mode requires at least one field" }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("letters")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, letter_text, direction, target_date, title, prompt_used, author_state_snapshot, target_state_snapshot, status, delivered_at, pinned, delivery_channels, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, letter: data });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase
    .from("letters")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
