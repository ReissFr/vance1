// Toggle / update / delete a single automation. Users can flip enabled or
// ask_first without re-specifying the whole rule — the brain creates the
// automation initially, this endpoint just exposes the mutable knobs.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface PatchBody {
  enabled?: boolean;
  ask_first?: boolean;
  title?: string;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as PatchBody;
  const update: Record<string, unknown> = {};
  if (body.enabled !== undefined) update.enabled = Boolean(body.enabled);
  if (body.ask_first !== undefined) update.ask_first = Boolean(body.ask_first);
  if (body.title !== undefined && body.title.trim()) update.title = body.title.trim();
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true });
  }
  update.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("automations")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("automations")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
