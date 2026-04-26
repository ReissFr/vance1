// Mutate a single commitment — mark done/cancelled, edit deadline, add notes.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface PatchBody {
  status?: "open" | "done" | "overdue" | "cancelled";
  deadline?: string | null;
  notes?: string | null;
  user_confirmed?: boolean;
  commitment_text?: string;
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
  if (body.status) update.status = body.status;
  if (body.deadline !== undefined) update.deadline = body.deadline;
  if (body.notes !== undefined) update.notes = body.notes;
  if (body.user_confirmed !== undefined) update.user_confirmed = Boolean(body.user_confirmed);
  if (body.commitment_text !== undefined && body.commitment_text.trim()) {
    update.commitment_text = body.commitment_text.trim();
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true });
  update.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("commitments")
    .update(update)
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
    .from("commitments")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
