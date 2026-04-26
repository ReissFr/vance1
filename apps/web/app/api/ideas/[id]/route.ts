// Update or delete a single idea. Status transitions:
// 'adopted' accepts an optional adopted_to label ("became goal: ship v1").

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_KINDS = new Set(["product", "content", "venture", "optimization", "other"]);
const VALID_STATUSES = new Set(["fresh", "exploring", "shelved", "adopted"]);

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
  if (body.heat !== undefined) {
    const n = Number(body.heat);
    if (!Number.isFinite(n) || n < 1 || n > 5) {
      return NextResponse.json({ error: "heat 1-5" }, { status: 400 });
    }
    patch.heat = Math.round(n);
  }
  if (body.adopted_to !== undefined) {
    patch.adopted_to =
      typeof body.adopted_to === "string" ? body.adopted_to.trim().slice(0, 200) || null : null;
  }
  if (body.note !== undefined) {
    patch.note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) || null : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("ideas")
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
    .from("ideas")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
