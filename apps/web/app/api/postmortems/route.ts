// GET /api/postmortems — list postmortems across all decisions.
//
// Query:
//   ?status=due | fired | responded | cancelled | all   (default: due)
//     - due: not yet fired, not responded, not cancelled, due_at <= now()+1d
//     - fired: fired_at not null, responded_at null, not cancelled
//     - responded: responded_at not null
//     - cancelled: cancelled_at not null
//     - all: everything
//   ?decision_id=<uuid>  filter to one decision
//   ?limit=N             default 50, max 200
//
// Returns rows joined with decision title/tags so the UI can show context
// without a second round-trip.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Row = {
  id: string;
  decision_id: string;
  due_at: string;
  scheduled_offset: string | null;
  fired_at: string | null;
  fired_via: string | null;
  responded_at: string | null;
  actual_outcome: string | null;
  outcome_match: number | null;
  surprise_note: string | null;
  lesson: string | null;
  verdict: string | null;
  cancelled_at: string | null;
  created_at: string;
  decisions: { id: string; title: string; choice: string | null; expected_outcome: string | null; tags: string[] | null; created_at: string } | null;
};

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = (url.searchParams.get("status") ?? "due") as "due" | "fired" | "responded" | "cancelled" | "all";
  const decisionId = url.searchParams.get("decision_id");
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Math.max(1, Math.min(200, isNaN(limitRaw) ? 50 : limitRaw));

  let q = supabase
    .from("decision_postmortems")
    .select("id, decision_id, due_at, scheduled_offset, fired_at, fired_via, responded_at, actual_outcome, outcome_match, surprise_note, lesson, verdict, cancelled_at, created_at, decisions(id, title, choice, expected_outcome, tags, created_at)")
    .eq("user_id", user.id);

  if (decisionId) q = q.eq("decision_id", decisionId);

  const now = new Date();
  const dayAhead = new Date(now.getTime() + 86400000).toISOString();

  if (status === "due") {
    q = q.is("responded_at", null).is("cancelled_at", null).is("fired_at", null).lte("due_at", dayAhead);
    q = q.order("due_at", { ascending: true });
  } else if (status === "fired") {
    q = q.not("fired_at", "is", null).is("responded_at", null).is("cancelled_at", null);
    q = q.order("fired_at", { ascending: false });
  } else if (status === "responded") {
    q = q.not("responded_at", "is", null);
    q = q.order("responded_at", { ascending: false });
  } else if (status === "cancelled") {
    q = q.not("cancelled_at", "is", null);
    q = q.order("cancelled_at", { ascending: false });
  } else {
    q = q.order("due_at", { ascending: false });
  }
  q = q.limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as Row[];

  let calibration: { responded: number; avg_outcome_match: number | null; right_call: number; wrong_call: number; mixed: number; too_early: number; unclear: number } | null = null;
  if (status === "responded" || status === "all") {
    const responded = rows.filter((r) => r.responded_at);
    const matches = responded.map((r) => r.outcome_match).filter((n): n is number => typeof n === "number");
    const avg = matches.length === 0 ? null : Math.round((matches.reduce((a, b) => a + b, 0) / matches.length) * 100) / 100;
    const tally = (label: string) => responded.filter((r) => r.verdict === label).length;
    calibration = {
      responded: responded.length,
      avg_outcome_match: avg,
      right_call: tally("right_call"),
      wrong_call: tally("wrong_call"),
      mixed: tally("mixed"),
      too_early: tally("too_early"),
      unclear: tally("unclear"),
    };
  }

  return NextResponse.json({ postmortems: rows, calibration });
}
