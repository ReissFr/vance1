// Delete or patch a single memory. RLS is scoped by user_id so the admin
// client is safe here — we verify the row belongs to the caller before
// mutating. PATCH currently only supports toggling pinned.

import { NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabaseAdmin()
    .from("memories")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { pinned?: boolean };
  const update: { pinned?: boolean } = {};
  if (typeof body.pinned === "boolean") update.pinned = body.pinned;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no valid fields" }, { status: 400 });
  }

  const { error } = await supabaseAdmin()
    .from("memories")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
