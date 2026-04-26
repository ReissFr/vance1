// Brain tools for the Decision Postmortem Loop. The user logs a decision
// today; we schedule check-ins ("did this play out?") at 1w / 1mo / 3mo /
// 6mo. When a check-in fires, the user replies with what actually happened
// + how closely it matched the prediction (1-5) + a verdict. Aggregating
// across all postmortems gives the user a calibration signal — are they a
// good predictor of their own decisions, and which decision-classes do they
// systematically over- or under-estimate.

import { z } from "zod";
import { defineTool } from "./types";

type PostmortemRow = {
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
  decisions?: { id: string; title: string; choice: string | null; expected_outcome: string | null; tags: string[] | null; created_at: string } | null;
};

const VALID_OFFSETS = ["1w", "2w", "1mo", "3mo", "6mo", "1y", "2y"] as const;

export const schedulePostmortemTool = defineTool({
  name: "schedule_postmortem",
  description: [
    "Schedule one or more 'did this play out?' check-ins on a previously",
    "logged decision. The check-ins fire as WhatsApp nudges at each offset",
    "from the decision date.",
    "",
    "Required: decision_id (uuid of the decision).",
    "Optional: offsets (array, default ['1w','1mo','3mo','6mo']). Valid",
    "values: 1w, 2w, 1mo, 3mo, 6mo, 1y, 2y. Pass replace_pending=true to",
    "cancel any unfired check-ins before scheduling fresh ones.",
    "",
    "Use when: the user has just logged a decision with an expected",
    "outcome and wants to be held accountable; they say 'remind me to",
    "check back on this', 'see if this was the right call', 'check in",
    "with me in 3 months on this'; or as the natural close to a heavy",
    "decision-logging cycle.",
  ].join("\n"),
  schema: z.object({
    decision_id: z.string().uuid(),
    offsets: z.array(z.enum(VALID_OFFSETS)).optional(),
    replace_pending: z.boolean().optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      decision_id: { type: "string" },
      offsets: { type: "array", items: { type: "string", enum: VALID_OFFSETS as unknown as string[] } },
      replace_pending: { type: "boolean" },
    },
    required: ["decision_id"],
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/decisions/${input.decision_id}/postmortems`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({
        offsets: input.offsets ?? ["1w", "1mo", "3mo", "6mo"],
        replace_pending: input.replace_pending === true,
      }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `schedule failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { scheduled?: PostmortemRow[]; decision?: { id: string; title: string } };
    return {
      ok: true,
      decision: j.decision,
      scheduled: (j.scheduled ?? []).map((p) => ({
        id: p.id,
        due_at: p.due_at,
        scheduled_offset: p.scheduled_offset,
      })),
    };
  },
});

export const listPostmortemsTool = defineTool({
  name: "list_postmortems",
  description: [
    "List the user's decision postmortems (check-ins).",
    "",
    "Optional: status (due | fired | responded | cancelled | all, default",
    "'due'); decision_id (filter to one decision); limit (default 50).",
    "",
    "Returns rows with the parent decision title + outcome data when",
    "responded. When status is 'responded' or 'all', includes a calibration",
    "summary: count, average prediction-match (1-5), and verdict tally.",
    "",
    "Use when: the user asks 'what did I decide and how did it pan out',",
    "'how's my track record', 'what's coming up to revisit', 'show me my",
    "recent postmortems', or before a heavy decision (so the brain can",
    "factor in the user's known calibration biases).",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["due", "fired", "responded", "cancelled", "all"]).optional().default("due"),
    decision_id: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(200).optional().default(50),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["due", "fired", "responded", "cancelled", "all"] },
      decision_id: { type: "string" },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "due";
    const limit = input.limit ?? 50;
    let q = ctx.supabase
      .from("decision_postmortems")
      .select("id, decision_id, due_at, scheduled_offset, fired_at, fired_via, responded_at, actual_outcome, outcome_match, surprise_note, lesson, verdict, cancelled_at, created_at, decisions(id, title, choice, expected_outcome, tags, created_at)")
      .eq("user_id", ctx.userId);
    if (input.decision_id) q = q.eq("decision_id", input.decision_id);

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
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as unknown as PostmortemRow[];

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

    return {
      ok: true,
      count: rows.length,
      calibration,
      postmortems: rows.map((r) => ({
        id: r.id,
        decision_id: r.decision_id,
        decision_title: r.decisions?.title ?? null,
        decision_expected: r.decisions?.expected_outcome ?? null,
        decision_choice: r.decisions?.choice ?? null,
        decision_tags: r.decisions?.tags ?? null,
        due_at: r.due_at,
        scheduled_offset: r.scheduled_offset,
        fired_at: r.fired_at,
        responded_at: r.responded_at,
        actual_outcome: r.actual_outcome,
        outcome_match: r.outcome_match,
        verdict: r.verdict,
        surprise_note: r.surprise_note,
        lesson: r.lesson,
        cancelled_at: r.cancelled_at,
      })),
    };
  },
});

export const respondToPostmortemTool = defineTool({
  name: "respond_to_postmortem",
  description: [
    "Record the user's response to a postmortem check-in: what actually",
    "happened, how closely it matched their prediction, and the verdict.",
    "",
    "Required: postmortem_id (uuid), actual_outcome (string ≥4 chars),",
    "outcome_match (1-5: 1=nothing like expected, 5=exactly as expected),",
    "verdict (right_call | wrong_call | mixed | too_early | unclear).",
    "Optional: surprise_note, lesson.",
    "",
    "Use when: the user responds to a postmortem nudge in conversation",
    "('that thing I decided three months ago — turns out it didn't pan",
    "out, the market shifted'), or you've prompted them to close out a",
    "fired check-in. Translate their natural language into the structured",
    "fields. If the user is uncertain, prefer 'too_early' over inventing",
    "a verdict.",
    "",
    "On success the parent decision row is also marked reviewed (one-",
    "shot — only the first response stamps it).",
  ].join("\n"),
  schema: z.object({
    postmortem_id: z.string().uuid(),
    actual_outcome: z.string().min(4).max(4000),
    outcome_match: z.number().int().min(1).max(5),
    verdict: z.enum(["right_call", "wrong_call", "mixed", "too_early", "unclear"]),
    surprise_note: z.string().max(2000).optional(),
    lesson: z.string().max(2000).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      postmortem_id: { type: "string" },
      actual_outcome: { type: "string" },
      outcome_match: { type: "number" },
      verdict: { type: "string", enum: ["right_call", "wrong_call", "mixed", "too_early", "unclear"] },
      surprise_note: { type: "string" },
      lesson: { type: "string" },
    },
    required: ["postmortem_id", "actual_outcome", "outcome_match", "verdict"],
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/postmortems/${input.postmortem_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({
        actual_outcome: input.actual_outcome,
        outcome_match: input.outcome_match,
        verdict: input.verdict,
        surprise_note: input.surprise_note,
        lesson: input.lesson,
      }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { postmortem?: PostmortemRow };
    if (!j.postmortem) return { ok: false, error: "no postmortem returned" };
    return {
      ok: true,
      postmortem: {
        id: j.postmortem.id,
        decision_id: j.postmortem.decision_id,
        verdict: j.postmortem.verdict,
        outcome_match: j.postmortem.outcome_match,
        responded_at: j.postmortem.responded_at,
      },
    };
  },
});
