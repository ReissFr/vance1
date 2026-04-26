// Decision log CRUD. GET supports ?filter=open|due|reviewed|all (default open).
// POST accepts title + choice (required) and optional context/alternatives/
// expected_outcome/review_in_days/tags. Server fills review_at if review_in_days.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type DecisionRow = {
  id: string;
  title: string;
  context: string | null;
  choice: string;
  alternatives: string | null;
  expected_outcome: string | null;
  review_at: string | null;
  reviewed_at: string | null;
  outcome_note: string | null;
  outcome_label: string | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const filter = (req.nextUrl.searchParams.get("filter") ?? "open").toLowerCase();
  const today = ymd(new Date());

  let q = supabase
    .from("decisions")
    .select("id, title, context, choice, alternatives, expected_outcome, review_at, reviewed_at, outcome_note, outcome_label, tags, created_at, updated_at")
    .eq("user_id", user.id);

  if (filter === "open") {
    q = q.is("reviewed_at", null);
  } else if (filter === "reviewed") {
    q = q.not("reviewed_at", "is", null);
  } else if (filter === "due") {
    q = q.is("reviewed_at", null).lte("review_at", today);
  }

  q = q.order("created_at", { ascending: false });

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as DecisionRow[];

  const { count: dueCount } = await supabase
    .from("decisions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("reviewed_at", null)
    .lte("review_at", today);

  return NextResponse.json({ rows, due_count: dueCount ?? 0 });
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
  const choice = typeof body.choice === "string" ? body.choice.trim().slice(0, 1000) : "";
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  if (!choice) return NextResponse.json({ error: "choice required" }, { status: 400 });

  const context = typeof body.context === "string" ? body.context.trim().slice(0, 2000) : null;
  const alternatives = typeof body.alternatives === "string" ? body.alternatives.trim().slice(0, 2000) : null;
  const expected = typeof body.expected_outcome === "string" ? body.expected_outcome.trim().slice(0, 2000) : null;

  let reviewAt: string | null = null;
  if (typeof body.review_at === "string" && body.review_at.match(/^\d{4}-\d{2}-\d{2}$/)) {
    reviewAt = body.review_at;
  } else if (typeof body.review_in_days === "number" && body.review_in_days > 0) {
    const d = new Date();
    d.setDate(d.getDate() + Math.min(365, Math.floor(body.review_in_days)));
    reviewAt = ymd(d);
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 10)
    : [];

  const { data, error } = await supabase
    .from("decisions")
    .insert({
      user_id: user.id,
      title,
      choice,
      context: context || null,
      alternatives: alternatives || null,
      expected_outcome: expected || null,
      review_at: reviewAt,
      tags,
    })
    .select("id, title, context, choice, alternatives, expected_outcome, review_at, reviewed_at, outcome_note, outcome_label, tags, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ decision: data });
}
