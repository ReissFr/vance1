// Brain tool that aggregates open loops across every journal in one shot.
// Cheaper than seven separate list_* calls when the user asks "what should I
// be thinking about right now" or "what's still open". Returns the same shape
// the /loops page renders, so the brain can compose a single tight summary.

import { z } from "zod";
import { defineTool } from "./types";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const listOpenLoopsTool = defineTool({
  name: "list_open_loops",
  description: [
    "Return a one-shot snapshot of everything still open across the user's",
    "journals: today's intention (if not yet hit), commitments due ≤ 7 days,",
    "active questions, hot ideas (heat ≥ 4), goals due ≤ 14 days, decisions",
    "whose review_at is past due, and recent lessons (≤ 3 days).",
    "",
    "Use when the user says 'what's still open', 'what should I focus on',",
    "'what loops am I carrying', or before composing a status update.",
    "Cheaper than calling list_questions + list_ideas + list_goals separately.",
  ].join("\n"),
  schema: z.object({}),
  inputSchema: { type: "object", properties: {} },
  async run(_input, ctx) {
    const userId = ctx.userId;
    const now = new Date();
    const todayStr = todayYmd();
    const sevenDayHorizon = new Date(now.getTime() + 7 * 86400000).toISOString();
    const fourteenDayYmd = (() => {
      const d = new Date(now.getTime() + 14 * 86400000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
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
      ctx.supabase
        .from("intentions")
        .select("text, completed_at, carried_from")
        .eq("user_id", userId)
        .eq("log_date", todayStr)
        .maybeSingle(),
      ctx.supabase
        .from("commitments")
        .select("direction, other_party, commitment_text, deadline")
        .eq("user_id", userId)
        .eq("status", "open")
        .or(`deadline.lte.${sevenDayHorizon},deadline.is.null`)
        .order("deadline", { ascending: true, nullsFirst: false })
        .limit(15),
      ctx.supabase
        .from("questions")
        .select("text, kind, priority")
        .eq("user_id", userId)
        .in("status", ["open", "exploring"])
        .order("priority", { ascending: true })
        .limit(8),
      ctx.supabase
        .from("ideas")
        .select("text, kind, heat")
        .eq("user_id", userId)
        .in("status", ["fresh", "exploring"])
        .gte("heat", 4)
        .order("heat", { ascending: false })
        .limit(8),
      ctx.supabase
        .from("goals")
        .select("title, target_date, progress_pct")
        .eq("user_id", userId)
        .eq("status", "active")
        .not("target_date", "is", null)
        .lte("target_date", fourteenDayYmd)
        .order("target_date", { ascending: true })
        .limit(8),
      ctx.supabase
        .from("decisions")
        .select("title, review_at")
        .eq("user_id", userId)
        .is("reviewed_at", null)
        .not("review_at", "is", null)
        .lte("review_at", todayStr)
        .order("review_at", { ascending: true })
        .limit(8),
      ctx.supabase
        .from("reflections")
        .select("text, kind")
        .eq("user_id", userId)
        .in("kind", ["lesson", "realisation"])
        .gte("created_at", reflectionWindow)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const intentionRow = intention.data as
      | { text: string; completed_at: string | null; carried_from: string | null }
      | null;

    return {
      ok: true,
      todays_intention:
        intentionRow && !intentionRow.completed_at
          ? { text: intentionRow.text, carried: Boolean(intentionRow.carried_from) }
          : null,
      commitments_due_7d: commitments.data ?? [],
      open_questions: questions.data ?? [],
      hot_ideas: ideas.data ?? [],
      goals_due_14d: goals.data ?? [],
      decisions_to_review: decisions.data ?? [],
      recent_lessons: reflections.data ?? [],
    };
  },
});
