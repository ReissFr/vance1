// Mutate a single receipt — confirm it (user verified the extraction) or
// archive/unarchive it for the "hide everything I've already reconciled"
// flow.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface PatchBody {
  archived?: boolean;
  user_confirmed?: boolean;
  category?: string | null;
  merchant?: string;
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
  if (body.archived !== undefined) update.archived = Boolean(body.archived);
  if (body.user_confirmed !== undefined) update.user_confirmed = Boolean(body.user_confirmed);
  if (body.category !== undefined) update.category = body.category ?? null;
  if (body.merchant !== undefined && body.merchant.trim()) update.merchant = body.merchant.trim();
  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true });
  update.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("receipts")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
