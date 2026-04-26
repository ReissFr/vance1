// Update or delete a single goal. PATCH accepts field edits, milestone
// replacement, and status transitions ('done' stamps completed_at).

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Milestone = { text: string; done_at: string | null };

const VALID_KINDS = new Set(["quarterly", "monthly", "yearly", "custom"]);
const VALID_STATUSES = new Set(["active", "done", "dropped"]);

function sanitizeMilestones(input: unknown): Milestone[] | null {
  if (!Array.isArray(input)) return null;
  return input
    .filter((m): m is Record<string, unknown> => typeof m === "object" && m != null)
    .map((m) => {
      const text = typeof m.text === "string" ? m.text.trim().slice(0, 200) : "";
      const doneAt =
        typeof m.done_at === "string" && !Number.isNaN(Date.parse(m.done_at))
          ? new Date(m.done_at).toISOString()
          : null;
      return { text, done_at: doneAt };
    })
    .filter((m) => m.text.length > 0)
    .slice(0, 30);
}

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
  if (typeof body.title === "string") {
    const t = body.title.trim().slice(0, 200);
    if (!t) return NextResponse.json({ error: "title empty" }, { status: 400 });
    patch.title = t;
  }
  if (body.why !== undefined) {
    patch.why = typeof body.why === "string" ? body.why.trim().slice(0, 1000) || null : null;
  }
  if (typeof body.kind === "string" && VALID_KINDS.has(body.kind)) {
    patch.kind = body.kind;
  }
  if (body.target_date !== undefined) {
    if (body.target_date === null) patch.target_date = null;
    else if (typeof body.target_date === "string" && body.target_date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      patch.target_date = body.target_date;
    }
  }
  if (typeof body.status === "string" && VALID_STATUSES.has(body.status)) {
    patch.status = body.status;
    if (body.status === "done") {
      patch.completed_at = new Date().toISOString();
      patch.progress_pct = 100;
    } else if (body.status === "active") {
      patch.completed_at = null;
    }
  }
  if (body.progress_pct !== undefined) {
    const n = Number(body.progress_pct);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return NextResponse.json({ error: "progress_pct 0-100" }, { status: 400 });
    }
    patch.progress_pct = Math.round(n);
  }
  if (body.milestones !== undefined) {
    const m = sanitizeMilestones(body.milestones);
    if (m === null) return NextResponse.json({ error: "milestones must be array" }, { status: 400 });
    patch.milestones = m;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("goals")
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
    .from("goals")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
