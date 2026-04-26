// PATCH supports { resolve: "yes"|"no"|"withdraw", note? } to mark a
// prediction's outcome, plus per-field updates of an open prediction
// (claim/confidence/resolve_by/category/tags) for typo fixes.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

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

  if (typeof body.resolve === "string") {
    let status: string;
    if (body.resolve === "yes") status = "resolved_yes";
    else if (body.resolve === "no") status = "resolved_no";
    else if (body.resolve === "withdraw") status = "withdrawn";
    else {
      return NextResponse.json({ error: "resolve must be yes/no/withdraw" }, { status: 400 });
    }
    const note =
      typeof body.note === "string" ? body.note.trim().slice(0, 1000) || null : null;
    const { error } = await supabase
      .from("predictions")
      .update({
        status,
        resolved_at: new Date().toISOString(),
        resolved_note: note,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, status });
  }

  if (body.reopen === true) {
    const { error } = await supabase
      .from("predictions")
      .update({
        status: "open",
        resolved_at: null,
        resolved_note: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, reopened: true });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.claim === "string") {
    const t = body.claim.trim().slice(0, 500);
    if (!t) return NextResponse.json({ error: "claim empty" }, { status: 400 });
    patch.claim = t;
  }
  const conf = clampConfidence(body.confidence);
  if (conf !== null) patch.confidence = conf;
  if (typeof body.resolve_by === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.resolve_by)) {
    patch.resolve_by = body.resolve_by;
  }
  if (typeof body.category === "string") {
    patch.category = body.category.trim().slice(0, 60) || null;
  }
  if (Array.isArray(body.tags)) {
    patch.tags = sanitizeTags(body.tags);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("predictions")
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
    .from("predictions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
