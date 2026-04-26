// PATCH /api/counter-self/:id — annotate or resolve.
//   Bodies (mutually exclusive groups):
//     { response: "engaged" | "deferred" | "updated_position" | "dismissed",
//       user_response_body?: string,
//       new_position_text?: string  (only for updated_position) }
//     { user_response_body: string }   (annotate without resolving)
//     { pin: boolean }
//     { archive: true } / { restore: true }
//
// DELETE /api/counter-self/:id — hard remove.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_RESPONSES = new Set(["engaged", "deferred", "updated_position", "dismissed"]);

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  let body: {
    response?: string;
    user_response_body?: string;
    new_position_text?: string;
    pin?: boolean;
    archive?: boolean;
    restore?: boolean;
  } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const update: Record<string, unknown> = {};
  if (body.response != null) {
    if (typeof body.response !== "string" || !VALID_RESPONSES.has(body.response)) {
      return NextResponse.json({ error: "response must be engaged | deferred | updated_position | dismissed" }, { status: 400 });
    }
    update.user_response = body.response;
    update.resolved_at = new Date().toISOString();
    if (body.response === "updated_position") {
      if (typeof body.new_position_text !== "string" || body.new_position_text.trim().length < 8) {
        return NextResponse.json({ error: "new_position_text required (min 8 chars) for response=updated_position" }, { status: 400 });
      }
      update.new_position_text = body.new_position_text.trim().slice(0, 1200);
    }
  }
  if (body.user_response_body != null) {
    if (typeof body.user_response_body !== "string") return NextResponse.json({ error: "user_response_body must be string" }, { status: 400 });
    update.user_response_body = body.user_response_body.trim().slice(0, 2000);
  }
  if (body.pin != null) {
    if (typeof body.pin !== "boolean") return NextResponse.json({ error: "pin must be boolean" }, { status: 400 });
    update.pinned = body.pin;
  }
  if (body.archive === true) update.archived_at = new Date().toISOString();
  if (body.restore === true) update.archived_at = null;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no recognised fields" }, { status: 400 });
  }

  const { data: updated, error } = await supabase
    .from("counter_self_chambers")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, target_kind, target_id, target_snapshot, challenger_voice, argument_body, strongest_counterpoint, falsifiable_predictions, user_response, user_response_body, new_position_text, resolved_at, pinned, archived_at, latency_ms, model, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ counter_self: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const { error } = await supabase
    .from("counter_self_chambers")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
