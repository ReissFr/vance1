// Update or delete a single question. Special payload: {answered: true, answer}
// transitions status='answered' and stamps answered_at. {answered: false}
// reopens (status='exploring', clears answered_at).

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_KINDS = new Set(["strategic", "customer", "technical", "personal", "other"]);
const VALID_STATUSES = new Set(["open", "exploring", "answered", "dropped"]);

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
  if (typeof body.text === "string") {
    const t = body.text.trim().slice(0, 2000);
    if (!t) return NextResponse.json({ error: "text empty" }, { status: 400 });
    patch.text = t;
  }
  if (typeof body.kind === "string" && VALID_KINDS.has(body.kind)) {
    patch.kind = body.kind;
  }
  if (typeof body.status === "string" && VALID_STATUSES.has(body.status)) {
    patch.status = body.status;
  }
  if (body.priority !== undefined) {
    const n = Number(body.priority);
    if (!Number.isFinite(n) || n < 1 || n > 3) {
      return NextResponse.json({ error: "priority 1-3" }, { status: 400 });
    }
    patch.priority = Math.round(n);
  }
  if (body.answered === true) {
    patch.status = "answered";
    patch.answered_at = new Date().toISOString();
    if (typeof body.answer === "string") patch.answer = body.answer.trim().slice(0, 2000);
  } else if (body.answered === false) {
    patch.status = "exploring";
    patch.answered_at = null;
  } else if (body.answer !== undefined) {
    patch.answer = typeof body.answer === "string" ? body.answer.trim().slice(0, 2000) || null : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("questions")
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
    .from("questions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
