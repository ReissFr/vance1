// Goals CRUD. GET supports ?status=active|done|dropped|all (default active).
// POST creates a goal with optional initial milestones.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Milestone = { text: string; done_at: string | null };

const VALID_KINDS = new Set(["quarterly", "monthly", "yearly", "custom"]);
const VALID_STATUSES = new Set(["active", "done", "dropped"]);

function sanitizeMilestones(input: unknown): Milestone[] {
  if (!Array.isArray(input)) return [];
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

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const status = (req.nextUrl.searchParams.get("status") ?? "active").toLowerCase();
  let q = supabase
    .from("goals")
    .select("id, title, why, kind, target_date, status, completed_at, progress_pct, milestones, tags, created_at, updated_at")
    .eq("user_id", user.id);
  if (status !== "all" && VALID_STATUSES.has(status)) {
    q = q.eq("status", status);
  }
  q = q
    .order("status", { ascending: true })
    .order("target_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const why = typeof body.why === "string" ? body.why.trim().slice(0, 1000) || null : null;
  const kind = typeof body.kind === "string" && VALID_KINDS.has(body.kind) ? body.kind : "quarterly";
  const targetDate =
    typeof body.target_date === "string" && body.target_date.match(/^\d{4}-\d{2}-\d{2}$/)
      ? body.target_date
      : null;
  const milestones = sanitizeMilestones(body.milestones);

  const { data, error } = await supabase
    .from("goals")
    .insert({
      user_id: user.id,
      title,
      why,
      kind,
      target_date: targetDate,
      milestones,
    })
    .select("id, title, why, kind, target_date, status, completed_at, progress_pct, milestones, tags, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ goal: data });
}
