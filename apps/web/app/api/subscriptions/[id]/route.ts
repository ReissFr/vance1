// PATCH — update status (cancel/reactivate), category, notes, user_confirmed
// DELETE — remove entirely (user no longer wants to track it)

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface PatchBody {
  status?: string;
  category?: string | null;
  notes?: string | null;
  user_confirmed?: boolean;
}

const VALID_STATUS = ["active", "trial", "cancelled", "paused", "unknown"];

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as PatchBody;
  const update: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!VALID_STATUS.includes(body.status)) {
      return NextResponse.json(
        { error: `status must be one of ${VALID_STATUS.join(", ")}` },
        { status: 400 },
      );
    }
    update.status = body.status;
  }
  if (body.category !== undefined) update.category = body.category;
  if (body.notes !== undefined) update.notes = body.notes;
  if (body.user_confirmed !== undefined) {
    update.user_confirmed = Boolean(body.user_confirmed);
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabase
    .from("subscriptions")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("subscriptions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
