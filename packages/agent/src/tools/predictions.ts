// Brain tools for the predictions log — calibration practice. The user
// states a falsifiable claim, a confidence (1-99), and a resolve-by date.
// When the date arrives or the outcome lands, mark it yes/no/withdrawn.
// Over time the calibration curve shows whether "I'm 80% sure" actually
// means right 80% of the time.
//
// Use when the user says "I bet…", "I'd put X% on…", "I predict…",
// "wager…", "odds are…". Push back if confidence is uncalibrated to the
// claim ("you said 90% — extraordinary; want to drop to 70?") and ALWAYS
// require a resolve_by date so it's a real prediction not a vague hope.

import { z } from "zod";
import { defineTool } from "./types";

type PredictionRow = {
  id: string;
  claim: string;
  confidence: number;
  resolve_by: string;
  status: "open" | "resolved_yes" | "resolved_no" | "withdrawn";
  resolved_at: string | null;
  resolved_note: string | null;
  category: string | null;
  tags: string[];
};

export const logPredictionTool = defineTool({
  name: "log_prediction",
  description: [
    "Log a forecast — a falsifiable claim with a confidence (1-99%) and a",
    "resolve-by date (YYYY-MM-DD). Required: claim, confidence, resolve_by.",
    "Optional: category (e.g. 'business','health','market'), tags.",
    "",
    "The claim must be specifically falsifiable — if you can't tell on the",
    "resolve date whether it happened, push back and ask the user to",
    "tighten the claim. Reject 50% (no information) — coerce to 51 or 49.",
  ].join("\n"),
  schema: z.object({
    claim: z.string().min(1).max(500),
    confidence: z.number().int().min(1).max(99),
    resolve_by: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
    category: z.string().max(60).optional(),
    tags: z.array(z.string().min(1).max(40)).max(12).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["claim", "confidence", "resolve_by"],
    properties: {
      claim: { type: "string" },
      confidence: { type: "number", description: "Integer 1-99 (no 50 — pick a side)" },
      resolve_by: { type: "string", description: "YYYY-MM-DD" },
      category: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
  },
  async run(input, ctx) {
    const conf = input.confidence === 50 ? 51 : input.confidence;
    const { data, error } = await ctx.supabase
      .from("predictions")
      .insert({
        user_id: ctx.userId,
        claim: input.claim.trim().slice(0, 500),
        confidence: conf,
        resolve_by: input.resolve_by,
        category: input.category?.trim().slice(0, 60) || null,
        tags: input.tags ?? [],
      })
      .select("id, claim, confidence, resolve_by")
      .single();
    if (error) return { ok: false, error: error.message };
    const r = data as { id: string; claim: string; confidence: number; resolve_by: string };
    return {
      ok: true,
      id: r.id,
      claim: r.claim,
      confidence: r.confidence,
      resolve_by: r.resolve_by,
    };
  },
});

export const listPredictionsTool = defineTool({
  name: "list_predictions",
  description: [
    "List the user's predictions. Optional: status filter ('open' default,",
    "'resolved' for yes+no, 'all', or specific 'resolved_yes'/'resolved_no'/",
    "'withdrawn'). Optional: due_within_days to find predictions resolving",
    "soon. Returns claim, confidence, resolve_by, status, resolved_note,",
    "tags. Use when the user asks 'what did I predict about X' or 'what",
    "predictions are due'.",
  ].join("\n"),
  schema: z.object({
    status: z
      .enum(["open", "resolved", "resolved_yes", "resolved_no", "withdrawn", "all"])
      .optional()
      .default("open"),
    due_within_days: z.number().int().min(1).max(365).optional(),
    limit: z.number().int().min(1).max(200).optional().default(50),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["open", "resolved", "resolved_yes", "resolved_no", "withdrawn", "all"],
      },
      due_within_days: { type: "number" },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "open";
    const limit = input.limit ?? 50;
    let q = ctx.supabase
      .from("predictions")
      .select("id, claim, confidence, resolve_by, status, resolved_at, resolved_note, category, tags")
      .eq("user_id", ctx.userId);
    if (status === "open") q = q.eq("status", "open");
    else if (status === "resolved") q = q.in("status", ["resolved_yes", "resolved_no"]);
    else if (status !== "all") q = q.eq("status", status);

    if (input.due_within_days !== undefined) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + input.due_within_days);
      q = q.lte("resolve_by", cutoff.toISOString().slice(0, 10));
    }

    q = q.order("resolve_by", { ascending: true }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as PredictionRow[];
    return {
      ok: true,
      count: rows.length,
      predictions: rows.map((r) => ({
        id: r.id,
        claim: r.claim,
        confidence: r.confidence,
        resolve_by: r.resolve_by,
        status: r.status,
        resolved_note: r.resolved_note,
        category: r.category,
        tags: r.tags,
      })),
    };
  },
});

export const resolvePredictionTool = defineTool({
  name: "resolve_prediction",
  description: [
    "Mark a prediction as resolved. Required: id (from list_predictions),",
    "verdict ('yes' = it happened, 'no' = it didn't, 'withdraw' = the",
    "claim is no longer well-defined or the user opts out). Optional: note",
    "describing what actually happened. Stamps resolved_at. After enough",
    "resolutions calibration_score reveals systematic bias.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    verdict: z.enum(["yes", "no", "withdraw"]),
    note: z.string().max(1000).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "verdict"],
    properties: {
      id: { type: "string" },
      verdict: { type: "string", enum: ["yes", "no", "withdraw"] },
      note: { type: "string" },
    },
  },
  async run(input, ctx) {
    let status: "resolved_yes" | "resolved_no" | "withdrawn";
    if (input.verdict === "yes") status = "resolved_yes";
    else if (input.verdict === "no") status = "resolved_no";
    else status = "withdrawn";

    const { data, error } = await ctx.supabase
      .from("predictions")
      .update({
        status,
        resolved_at: new Date().toISOString(),
        resolved_note: input.note?.trim().slice(0, 1000) || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id)
      .eq("user_id", ctx.userId)
      .select("claim, confidence")
      .single();
    if (error) return { ok: false, error: error.message };
    const r = data as { claim: string; confidence: number };
    return {
      ok: true,
      status,
      claim: r.claim,
      confidence: r.confidence,
    };
  },
});

export const calibrationScoreTool = defineTool({
  name: "calibration_score",
  description: [
    "Compute the user's calibration over all resolved predictions. Returns",
    "Brier score (lower is better, 0.25 = pure chance, 0 = perfect), total",
    "resolved count, hit/miss split, and 10-point confidence bands with",
    "their actual hit rate. Use when the user asks 'am I well-calibrated'",
    "or 'how good are my forecasts'. Read the bands — if 80% bucket has a",
    "60% hit rate, the user is overconfident at that level.",
  ].join("\n"),
  schema: z.object({}),
  inputSchema: { type: "object", properties: {} },
  async run(_input, ctx) {
    const { data, error } = await ctx.supabase
      .from("predictions")
      .select("confidence, status")
      .eq("user_id", ctx.userId)
      .in("status", ["resolved_yes", "resolved_no"]);
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as Array<{ confidence: number; status: string }>;
    if (rows.length === 0) {
      return { ok: true, total: 0, message: "no resolved predictions yet" };
    }

    const bands = [
      { low: 1, high: 10 },
      { low: 11, high: 20 },
      { low: 21, high: 30 },
      { low: 31, high: 40 },
      { low: 41, high: 50 },
      { low: 51, high: 60 },
      { low: 61, high: 70 },
      { low: 71, high: 80 },
      { low: 81, high: 90 },
      { low: 91, high: 99 },
    ];
    const buckets = bands.map((b) => ({
      band: `${b.low}-${b.high}`,
      n: 0,
      yes: 0,
      hit_rate: null as number | null,
    }));
    for (const r of rows) {
      for (let i = 0; i < bands.length; i++) {
        const b = bands[i]!;
        if (r.confidence >= b.low && r.confidence <= b.high) {
          buckets[i]!.n += 1;
          if (r.status === "resolved_yes") buckets[i]!.yes += 1;
          break;
        }
      }
    }
    for (const b of buckets) {
      b.hit_rate = b.n === 0 ? null : Math.round((b.yes / b.n) * 100) / 100;
    }

    let brier = 0;
    let yes = 0;
    for (const r of rows) {
      const p = r.confidence / 100;
      const o = r.status === "resolved_yes" ? 1 : 0;
      brier += (p - o) ** 2;
      if (o === 1) yes += 1;
    }
    brier = brier / rows.length;

    return {
      ok: true,
      total: rows.length,
      yes,
      no: rows.length - yes,
      brier: Math.round(brier * 1000) / 1000,
      bands: buckets.filter((b) => b.n > 0),
    };
  },
});
