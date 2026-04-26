// Brain tools for counterfactual replay — what would have happened if the
// user had chosen the alternative on a past decision. Use when the user
// says "what if I'd done X", "I keep wondering about the other path",
// "replay this decision", "should I have taken job Y", etc. Also useful
// before reviewing a decision: surface the alternative-path projection so
// the user has both columns to weigh.

import { z } from "zod";
import { defineTool } from "./types";

type CounterfactualRow = {
  id: string;
  decision_id: string;
  alternative_choice: string;
  body: string;
  credibility: number;
  user_note: string | null;
  verdict: "regret_taken_path" | "validated_taken_path" | "neutral" | "unsure";
  created_at: string;
};

export const runCounterfactualTool = defineTool({
  name: "run_counterfactual",
  description: [
    "Generate a counterfactual replay for a past decision — a narrative",
    "of what would likely have happened if the user had chosen otherwise.",
    "Required: decision_id. Optional: alternative (the path not taken; if",
    "omitted, the brain uses the decision's alternatives field).",
    "",
    "Use when the user says 'what if I had…', 'I keep wondering about the",
    "other choice', 'replay this', 'should I have…'. The replay is",
    "grounded in the user's themes, reflections, and wins from before the",
    "decision date — it's a projection, not a fantasy.",
  ].join("\n"),
  schema: z.object({
    decision_id: z.string().uuid(),
    alternative: z.string().min(1).max(400).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["decision_id"],
    properties: {
      decision_id: { type: "string" },
      alternative: { type: "string" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (ctx.supabase as unknown as { rest: { headers: Record<string, string> } }).rest?.headers?.Authorization;
    if (!sessionToken) {
      return { ok: false, error: "no session token; ask the user to open /counterfactuals and tap Replay" };
    }
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/decisions/${input.decision_id}/counterfactual`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ alternative: input.alternative }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `replay failed (${r.status}): ${err.slice(0, 200)}` };
    }
    const j = (await r.json()) as { counterfactual?: CounterfactualRow };
    if (!j.counterfactual) return { ok: false, error: "no counterfactual returned" };
    return {
      ok: true,
      id: j.counterfactual.id,
      alternative: j.counterfactual.alternative_choice,
      credibility: j.counterfactual.credibility,
      body: j.counterfactual.body,
    };
  },
});

export const listCounterfactualsTool = defineTool({
  name: "list_counterfactuals",
  description: [
    "List counterfactual replays the user has run. Optional: decision_id",
    "to filter to one decision; verdict filter (regret_taken_path |",
    "validated_taken_path | neutral | unsure | all); limit. Useful when",
    "reviewing a decision (so you can read both paths side by side) or",
    "when looking for patterns in what the user regrets vs validates.",
  ].join("\n"),
  schema: z.object({
    decision_id: z.string().uuid().optional(),
    verdict: z
      .enum(["regret_taken_path", "validated_taken_path", "neutral", "unsure", "all"])
      .optional()
      .default("all"),
    limit: z.number().int().min(1).max(50).optional().default(20),
  }),
  inputSchema: {
    type: "object",
    properties: {
      decision_id: { type: "string" },
      verdict: { type: "string", enum: ["regret_taken_path", "validated_taken_path", "neutral", "unsure", "all"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const verdict = input.verdict ?? "all";
    const limit = input.limit ?? 20;
    let q = ctx.supabase
      .from("counterfactuals")
      .select("id, decision_id, alternative_choice, body, credibility, user_note, verdict, created_at")
      .eq("user_id", ctx.userId);
    if (input.decision_id) q = q.eq("decision_id", input.decision_id);
    if (verdict !== "all") q = q.eq("verdict", verdict);
    q = q.order("created_at", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as CounterfactualRow[];
    return {
      ok: true,
      count: rows.length,
      counterfactuals: rows.map((r) => ({
        id: r.id,
        decision_id: r.decision_id,
        alternative: r.alternative_choice,
        verdict: r.verdict,
        credibility: r.credibility,
        user_note: r.user_note,
        body: r.body,
        created_at: r.created_at,
      })),
    };
  },
});
