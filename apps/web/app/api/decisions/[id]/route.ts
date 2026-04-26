// Update or delete a single decision. PATCH accepts edits to any field plus
// the special review payload { reviewed: true, outcome_label, outcome_note }
// which stamps reviewed_at.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_LABELS = new Set(["right_call", "wrong_call", "mixed", "unclear"]);

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

  const patch: Record<string, unknown> = {};

  if (typeof body.title === "string") {
    const t = body.title.trim().slice(0, 200);
    if (!t) return NextResponse.json({ error: "title empty" }, { status: 400 });
    patch.title = t;
  }
  if (typeof body.choice === "string") {
    const c = body.choice.trim().slice(0, 1000);
    if (!c) return NextResponse.json({ error: "choice empty" }, { status: 400 });
    patch.choice = c;
  }
  for (const k of ["context", "alternatives", "expected_outcome"] as const) {
    if (typeof body[k] === "string") {
      const v = (body[k] as string).trim().slice(0, 2000);
      patch[k] = v || null;
    } else if (body[k] === null) {
      patch[k] = null;
    }
  }
  if (typeof body.review_at === "string" && body.review_at.match(/^\d{4}-\d{2}-\d{2}$/)) {
    patch.review_at = body.review_at;
  } else if (body.review_at === null) {
    patch.review_at = null;
  }
  if (Array.isArray(body.tags)) {
    patch.tags = body.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 10);
  }

  if (body.reviewed === true) {
    patch.reviewed_at = new Date().toISOString();
    if (typeof body.outcome_label === "string" && VALID_LABELS.has(body.outcome_label)) {
      patch.outcome_label = body.outcome_label;
    }
    if (typeof body.outcome_note === "string") {
      patch.outcome_note = body.outcome_note.trim().slice(0, 2000) || null;
    }
  } else if (body.reviewed === false) {
    patch.reviewed_at = null;
    patch.outcome_label = null;
    patch.outcome_note = null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("decisions")
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
    .from("decisions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
