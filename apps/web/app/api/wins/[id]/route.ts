// Edit or delete a single win.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_KINDS = new Set(["shipped", "sale", "milestone", "personal", "other"]);

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
    const t = body.text.trim().slice(0, 500);
    if (!t) return NextResponse.json({ error: "text empty" }, { status: 400 });
    patch.text = t;
  }
  if (typeof body.kind === "string" && VALID_KINDS.has(body.kind)) {
    patch.kind = body.kind;
  }
  if (body.amount_cents !== undefined) {
    if (body.amount_cents === null) {
      patch.amount_cents = null;
    } else if (typeof body.amount_cents === "number" && Number.isFinite(body.amount_cents)) {
      patch.amount_cents = Math.round(body.amount_cents);
    }
  }
  if (body.related_to !== undefined) {
    patch.related_to = typeof body.related_to === "string" ? body.related_to.trim().slice(0, 200) || null : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { error } = await supabase
    .from("wins")
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
    .from("wins")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
