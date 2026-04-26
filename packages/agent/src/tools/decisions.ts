// Brain tools for the decision log. JARVIS can capture a decision in the
// moment ("log this: I'm killing the X feature because Y"), list what's open
// or due for review, and stamp the outcome later ("the bet on X paid off").

import { z } from "zod";
import { defineTool } from "./types";

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
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}

export const logDecisionTool = defineTool({
  name: "log_decision",
  description: [
    "Capture a decision in the user's decision log so they (and you) can",
    "revisit it later. Required: a short title and the choice. Optional:",
    "context (the situation), alternatives (what was rejected), expected_outcome",
    "(what success looks like), review_in_days (when to revisit — defaults",
    "to 14 if not given).",
    "",
    "Use when the user says: 'log this decision', 'I've decided to X', 'I'm",
    "going with Y over Z because…', 'remember I chose this'.",
  ].join("\n"),
  schema: z.object({
    title: z.string().min(2).max(200).describe("Short title for the decision."),
    choice: z.string().min(2).max(1000).describe("What was chosen, in one or two sentences."),
    context: z.string().max(2000).optional().describe("Why — the situation and constraints."),
    alternatives: z.string().max(2000).optional().describe("What else was considered and rejected."),
    expected_outcome: z.string().max(2000).optional().describe("What you expect to be true if this was the right call."),
    review_in_days: z.number().int().min(0).max(365).optional().describe("Days from now to review. 0 means never."),
  }),
  inputSchema: {
    type: "object",
    required: ["title", "choice"],
    properties: {
      title: { type: "string", description: "Short title for the decision." },
      choice: { type: "string", description: "What was chosen." },
      context: { type: "string", description: "Why — situation and constraints." },
      alternatives: { type: "string", description: "Rejected alternatives." },
      expected_outcome: { type: "string", description: "What success looks like." },
      review_in_days: { type: "number", description: "Days from now to review (0 = never)." },
    },
  },
  async run(input, ctx) {
    const days =
      typeof input.review_in_days === "number" ? input.review_in_days : 14;
    let reviewAt: string | null = null;
    if (days > 0) {
      const d = new Date();
      d.setDate(d.getDate() + days);
      reviewAt = ymd(d);
    }

    const { data, error } = await ctx.supabase
      .from("decisions")
      .insert({
        user_id: ctx.userId,
        title: input.title.trim().slice(0, 200),
        choice: input.choice.trim().slice(0, 1000),
        context: input.context?.trim().slice(0, 2000) || null,
        alternatives: input.alternatives?.trim().slice(0, 2000) || null,
        expected_outcome: input.expected_outcome?.trim().slice(0, 2000) || null,
        review_at: reviewAt,
      })
      .select("id, title, review_at")
      .single();
    if (error) return { ok: false, error: error.message };
    const r = data as { id: string; title: string; review_at: string | null };
    return { ok: true, id: r.id, title: r.title, review_at: r.review_at };
  },
});

export const listDecisionsTool = defineTool({
  name: "list_decisions",
  description: [
    "List the user's logged decisions. Filter: 'open' (unreviewed),",
    "'due' (review date in the past or today), 'reviewed' (already reviewed),",
    "or 'all'. Default 'open'. Returns up to 'limit' rows (default 20).",
    "",
    "Use before evening-wrap or weekly-review to surface decisions that need",
    "revisiting, or when the user asks 'what did I decide about X?'.",
  ].join("\n"),
  schema: z.object({
    filter: z.enum(["open", "due", "reviewed", "all"]).optional().default("open"),
    limit: z.number().int().min(1).max(100).optional().default(20),
  }),
  inputSchema: {
    type: "object",
    properties: {
      filter: { type: "string", enum: ["open", "due", "reviewed", "all"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const filter = input.filter ?? "open";
    const limit = input.limit ?? 20;
    const today = ymd(new Date());

    let q = ctx.supabase
      .from("decisions")
      .select(
        "id, title, context, choice, alternatives, expected_outcome, review_at, reviewed_at, outcome_note, outcome_label, tags, created_at",
      )
      .eq("user_id", ctx.userId);

    if (filter === "open") q = q.is("reviewed_at", null);
    else if (filter === "reviewed") q = q.not("reviewed_at", "is", null);
    else if (filter === "due") q = q.is("reviewed_at", null).lte("review_at", today);

    q = q.order("created_at", { ascending: false }).limit(limit);

    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as DecisionRow[];
    return {
      ok: true,
      count: rows.length,
      decisions: rows.map((r) => ({
        id: r.id,
        title: r.title,
        choice: r.choice,
        context: r.context,
        alternatives: r.alternatives,
        expected_outcome: r.expected_outcome,
        review_at: r.review_at,
        reviewed_at: r.reviewed_at,
        outcome_label: r.outcome_label,
        outcome_note: r.outcome_note,
        logged_at: r.created_at,
      })),
    };
  },
});

export const reviewDecisionTool = defineTool({
  name: "review_decision",
  description: [
    "Mark a decision as reviewed and stamp the outcome. Identify the",
    "decision either by 'id' (preferred — get from list_decisions) or by a",
    "partial 'title' for a fuzzy match. label: 'right_call' | 'wrong_call' |",
    "'mixed' | 'unclear'. Optional 'note' captures what was learned.",
    "",
    "If multiple decisions match the title, returns ambiguous=true with",
    "candidates. Use when the user says: 'that decision worked', 'turned",
    "out I was wrong about X', 'mark X as right_call'.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid().optional(),
    title: z.string().min(2).max(200).optional(),
    label: z.enum(["right_call", "wrong_call", "mixed", "unclear"]),
    note: z.string().max(2000).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["label"],
    properties: {
      id: { type: "string", description: "UUID of the decision." },
      title: { type: "string", description: "Partial title to match." },
      label: {
        type: "string",
        enum: ["right_call", "wrong_call", "mixed", "unclear"],
      },
      note: { type: "string", description: "Optional outcome note." },
    },
  },
  async run(input, ctx) {
    let targetId = input.id;
    let foundTitle: string | null = null;

    if (!targetId) {
      if (!input.title) return { ok: false, error: "id or title required" };
      const { data: matches } = await ctx.supabase
        .from("decisions")
        .select("id, title")
        .eq("user_id", ctx.userId)
        .is("reviewed_at", null)
        .ilike("title", `%${input.title}%`)
        .order("created_at", { ascending: false })
        .limit(5);
      const rows = (matches ?? []) as Array<{ id: string; title: string }>;
      if (rows.length === 0) {
        return { ok: false, error: "no open decision matches that title" };
      }
      if (rows.length > 1) {
        return {
          ok: false,
          ambiguous: true,
          candidates: rows.map((r) => ({ id: r.id, title: r.title })),
        };
      }
      const first = rows[0]!;
      targetId = first.id;
      foundTitle = first.title;
    }

    const { error } = await ctx.supabase
      .from("decisions")
      .update({
        reviewed_at: new Date().toISOString(),
        outcome_label: input.label,
        outcome_note: input.note?.trim().slice(0, 2000) || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", targetId)
      .eq("user_id", ctx.userId);
    if (error) return { ok: false, error: error.message };

    return { ok: true, id: targetId, title: foundTitle, label: input.label };
  },
});
