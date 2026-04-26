// Edit or delete a single important date.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

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
  if (typeof body.name === "string") {
    const t = body.name.trim().slice(0, 120);
    if (!t) return NextResponse.json({ error: "name empty" }, { status: 400 });
    patch.name = t;
  }
  if (typeof body.date_type === "string" && ["birthday", "anniversary", "custom"].includes(body.date_type)) {
    patch.date_type = body.date_type;
  }
  if (body.month != null) {
    const m = Number(body.month);
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      return NextResponse.json({ error: "month 1-12" }, { status: 400 });
    }
    patch.month = m;
  }
  if (body.day != null) {
    const d = Number(body.day);
    if (!Number.isInteger(d) || d < 1 || d > 31) {
      return NextResponse.json({ error: "day 1-31" }, { status: 400 });
    }
    patch.day = d;
  }
  if (body.year !== undefined) {
    if (body.year === null) {
      patch.year = null;
    } else {
      const y = Number(body.year);
      if (!Number.isInteger(y) || y < 1900 || y > 2100) {
        return NextResponse.json({ error: "year 1900-2100 or null" }, { status: 400 });
      }
      patch.year = y;
    }
  }
  if (body.lead_days != null) {
    const l = Number(body.lead_days);
    if (!Number.isInteger(l) || l < 0 || l > 60) {
      return NextResponse.json({ error: "lead_days 0-60" }, { status: 400 });
    }
    patch.lead_days = l;
  }
  if (body.note !== undefined) {
    patch.note = typeof body.note === "string" ? body.note.trim().slice(0, 500) || null : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("important_dates")
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
    .from("important_dates")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
