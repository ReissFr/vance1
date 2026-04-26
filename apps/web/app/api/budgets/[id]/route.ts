import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface PatchBody {
  amount?: number;
  category?: string;
  currency?: string;
  active?: boolean;
  include_subs?: boolean;
  notes?: string;
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
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.amount !== undefined) updates.amount = body.amount;
  if (body.category !== undefined) updates.category = body.category;
  if (body.currency !== undefined) updates.currency = body.currency;
  if (body.active !== undefined) updates.active = body.active;
  if (body.include_subs !== undefined) updates.include_subs = body.include_subs;
  if (body.notes !== undefined) updates.notes = body.notes;

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("budgets")
    .update(updates)
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

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("budgets")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
