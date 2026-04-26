// Brain tools for the open-question log. log_question is proactive: when an
// unanswered question surfaces in conversation ("we don't actually know if X"),
// the brain captures it without ceremony. answer_question closes the loop
// when the user finds the answer later, possibly via the research agent.

import { z } from "zod";
import { defineTool } from "./types";

type QuestionRow = {
  id: string;
  text: string;
  kind: string;
  status: string;
  priority: number;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
};

export const logQuestionTool = defineTool({
  name: "log_question",
  description: [
    "Capture an open question into the user's question log. Required: text.",
    "Optional: kind ('strategic'|'customer'|'technical'|'personal'|'other'),",
    "priority 1-3 (1 = urgent, 3 = someday).",
    "",
    "Be proactive: when the user says 'I don't know if', 'open question:',",
    "'should we X' or names a strategic uncertainty — log it without asking.",
    "Different from log_idea (possibilities) and log_decision (committed",
    "choices) — questions seek new information.",
  ].join("\n"),
  schema: z.object({
    text: z.string().min(2).max(2000),
    kind: z.enum(["strategic", "customer", "technical", "personal", "other"]).optional().default("other"),
    priority: z.number().int().min(1).max(3).optional().default(2),
  }),
  inputSchema: {
    type: "object",
    required: ["text"],
    properties: {
      text: { type: "string" },
      kind: { type: "string", enum: ["strategic", "customer", "technical", "personal", "other"] },
      priority: { type: "number", description: "1=urgent, 2=normal, 3=someday" },
    },
  },
  async run(input, ctx) {
    const { data, error } = await ctx.supabase
      .from("questions")
      .insert({
        user_id: ctx.userId,
        text: input.text.trim().slice(0, 2000),
        kind: input.kind ?? "other",
        priority: input.priority ?? 2,
      })
      .select("id, text, kind, priority")
      .single();
    if (error) return { ok: false, error: error.message };
    const r = data as { id: string; text: string; kind: string; priority: number };
    return { ok: true, id: r.id, text: r.text, kind: r.kind, priority: r.priority };
  },
});

export const listQuestionsTool = defineTool({
  name: "list_questions",
  description: [
    "List the user's open questions. Status filter: 'active' (open+exploring,",
    "default), 'open', 'exploring', 'answered', 'all'. Sorted by priority asc,",
    "newest first. Use when the user says 'what questions am I sitting on',",
    "'what should I be researching', or before kicking off research_agent.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["active", "open", "exploring", "answered", "all"]).optional().default("active"),
    kind: z.enum(["strategic", "customer", "technical", "personal", "other"]).optional(),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["active", "open", "exploring", "answered", "all"] },
      kind: { type: "string", enum: ["strategic", "customer", "technical", "personal", "other"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "active";
    const limit = input.limit ?? 30;
    let q = ctx.supabase
      .from("questions")
      .select("id, text, kind, status, priority, answer, answered_at, created_at")
      .eq("user_id", ctx.userId);
    if (status === "active") {
      q = q.in("status", ["open", "exploring"]);
    } else if (status !== "all") {
      q = q.eq("status", status);
    }
    if (input.kind) q = q.eq("kind", input.kind);
    q = q.order("priority", { ascending: true }).order("created_at", { ascending: false }).limit(limit);

    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as QuestionRow[];
    return {
      ok: true,
      count: rows.length,
      questions: rows.map((r) => ({
        id: r.id,
        text: r.text,
        kind: r.kind,
        status: r.status,
        priority: r.priority,
        answer: r.answer,
        answered_at: r.answered_at,
        captured_at: r.created_at,
      })),
    };
  },
});

export const answerQuestionTool = defineTool({
  name: "answer_question",
  description: [
    "Mark a question answered. Identify by id (preferred — from list_questions)",
    "or by partial text (fuzzy match across active questions). The answer text",
    "is required so the brain captures what was learned, not just that it's done.",
    "",
    "Use when the user says 'oh I figured out X', 'the answer to Y is Z', or",
    "after a research_agent run lands a clear answer.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid().optional(),
    text_match: z.string().min(2).max(200).optional(),
    answer: z.string().min(2).max(2000),
  }),
  inputSchema: {
    type: "object",
    required: ["answer"],
    properties: {
      id: { type: "string" },
      text_match: { type: "string", description: "Fuzzy match against question text if id unknown" },
      answer: { type: "string" },
    },
  },
  async run(input, ctx) {
    let id = input.id;
    if (!id) {
      if (!input.text_match) return { ok: false, error: "id or text_match required" };
      const { data } = await ctx.supabase
        .from("questions")
        .select("id, text")
        .eq("user_id", ctx.userId)
        .in("status", ["open", "exploring"])
        .ilike("text", `%${input.text_match}%`)
        .order("created_at", { ascending: false })
        .limit(5);
      const matches = (data ?? []) as Array<{ id: string; text: string }>;
      if (matches.length === 0) return { ok: false, error: "no active question matches that text" };
      if (matches.length > 1) {
        return {
          ok: false,
          ambiguous: true,
          candidates: matches.map((m) => ({ id: m.id, text: m.text })),
        };
      }
      id = matches[0]!.id;
    }

    const { error } = await ctx.supabase
      .from("questions")
      .update({
        status: "answered",
        answer: input.answer.trim().slice(0, 2000),
        answered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", ctx.userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, id };
  },
});
