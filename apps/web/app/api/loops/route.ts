// Open-loops aggregator. Single endpoint that pulls "what's still open right now"
// across every journal log so /loops can render the day's full picture in one
// query — six parallel reads, no new tables.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function GET(_req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = user.id;
  const now = new Date();
  const todayStr = todayYmd();
  const sevenDayHorizon = new Date(now.getTime() + 7 * 86400000).toISOString();
  const fourteenDayHorizonYmd = (() => {
    const d = new Date(now.getTime() + 14 * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const todayDate = todayStr;
  const reflectionWindow = new Date(now.getTime() - 3 * 86400000).toISOString();

  const [
    intention,
    commitments,
    questions,
    ideas,
    goals,
    decisions,
    reflections,
  ] = await Promise.all([
    supabase
      .from("intentions")
      .select("text, completed_at, carried_from")
      .eq("user_id", userId)
      .eq("log_date", todayStr)
      .maybeSingle(),
    supabase
      .from("commitments")
      .select("id, direction, other_party, commitment_text, deadline, status")
      .eq("user_id", userId)
      .eq("status", "open")
      .or(`deadline.lte.${sevenDayHorizon},deadline.is.null`)
      .order("deadline", { ascending: true, nullsFirst: false })
      .limit(15),
    supabase
      .from("questions")
      .select("id, text, kind, priority, created_at")
      .eq("user_id", userId)
      .in("status", ["open", "exploring"])
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("ideas")
      .select("id, text, kind, heat, created_at")
      .eq("user_id", userId)
      .in("status", ["fresh", "exploring"])
      .gte("heat", 4)
      .order("heat", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("goals")
      .select("id, title, target_date, progress_pct")
      .eq("user_id", userId)
      .eq("status", "active")
      .not("target_date", "is", null)
      .lte("target_date", fourteenDayHorizonYmd)
      .order("target_date", { ascending: true })
      .limit(8),
    supabase
      .from("decisions")
      .select("id, title, review_at, created_at")
      .eq("user_id", userId)
      .is("reviewed_at", null)
      .not("review_at", "is", null)
      .lte("review_at", todayDate)
      .order("review_at", { ascending: true })
      .limit(8),
    supabase
      .from("reflections")
      .select("id, text, kind, created_at")
      .eq("user_id", userId)
      .in("kind", ["lesson", "realisation"])
      .gte("created_at", reflectionWindow)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  return NextResponse.json({
    intention: intention.data ?? null,
    commitments: commitments.data ?? [],
    questions: questions.data ?? [],
    hot_ideas: ideas.data ?? [],
    goals_due: goals.data ?? [],
    stale_decisions: decisions.data ?? [],
    recent_lessons: reflections.data ?? [],
  });
}
