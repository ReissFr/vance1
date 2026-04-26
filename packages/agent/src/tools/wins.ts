// Brain tools for the wins log. Capture small wins in the moment, surface
// them back during evening wrap and weekly review so the user actually feels
// the progress they've been making.

import { z } from "zod";
import { defineTool } from "./types";

type WinRow = {
  id: string;
  text: string;
  kind: string;
  amount_cents: number | null;
  related_to: string | null;
  created_at: string;
};

export const logWinTool = defineTool({
  name: "log_win",
  description: [
    "Capture a win in the user's wins log. Use whenever they share progress —",
    "shipped a thing, closed a sale, hit a milestone, or just had a good moment.",
    "kind: 'shipped' | 'sale' | 'milestone' | 'personal' | 'other' (default 'other').",
    "Optional 'amount_cents' for sales/revenue wins (in pence — e.g. £250 = 25000).",
    "Optional 'related_to' to tie a win to a goal, decision, project, etc.",
    "",
    "Use proactively — if the user says 'just landed X' or 'finally got Y",
    "shipped', log it without being asked.",
  ].join("\n"),
  schema: z.object({
    text: z.string().min(2).max(500).describe("The win, one short sentence."),
    kind: z.enum(["shipped", "sale", "milestone", "personal", "other"]).optional().default("other"),
    amount_cents: z.number().int().optional().describe("For sale wins — amount in pence."),
    related_to: z.string().max(200).optional().describe("Goal/decision/project this win relates to."),
  }),
  inputSchema: {
    type: "object",
    required: ["text"],
    properties: {
      text: { type: "string" },
      kind: { type: "string", enum: ["shipped", "sale", "milestone", "personal", "other"] },
      amount_cents: { type: "number", description: "Amount in pence." },
      related_to: { type: "string" },
    },
  },
  async run(input, ctx) {
    const { data, error } = await ctx.supabase
      .from("wins")
      .insert({
        user_id: ctx.userId,
        text: input.text.trim().slice(0, 500),
        kind: input.kind ?? "other",
        amount_cents: input.amount_cents ?? null,
        related_to: input.related_to?.trim().slice(0, 200) || null,
      })
      .select("id, text, kind")
      .single();
    if (error) return { ok: false, error: error.message };
    const r = data as { id: string; text: string; kind: string };
    return { ok: true, id: r.id, text: r.text, kind: r.kind };
  },
});

export const recentWinsTool = defineTool({
  name: "recent_wins",
  description: [
    "Return the user's wins from the last N days (default 7). Useful in",
    "evening wrap, weekly review, or when the user is feeling stuck and you",
    "want to remind them what they've actually done. Returns counts + sum",
    "of amount_cents per kind.",
  ].join("\n"),
  schema: z.object({
    days: z.number().int().min(1).max(365).optional().default(7),
    limit: z.number().int().min(1).max(100).optional().default(50),
  }),
  inputSchema: {
    type: "object",
    properties: {
      days: { type: "number" },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const days = input.days ?? 7;
    const limit = input.limit ?? 50;
    const since = new Date();
    since.setDate(since.getDate() - days);
    const { data, error } = await ctx.supabase
      .from("wins")
      .select("id, text, kind, amount_cents, related_to, created_at")
      .eq("user_id", ctx.userId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as WinRow[];

    const byKind: Record<string, { count: number; amount_cents: number }> = {};
    let totalAmount = 0;
    for (const r of rows) {
      const k = r.kind;
      if (!byKind[k]) byKind[k] = { count: 0, amount_cents: 0 };
      byKind[k].count += 1;
      const amt = r.amount_cents ?? 0;
      byKind[k].amount_cents += amt;
      totalAmount += amt;
    }

    return {
      ok: true,
      days_window: days,
      total_count: rows.length,
      total_amount_cents: totalAmount,
      by_kind: byKind,
      wins: rows.map((r) => ({
        id: r.id,
        text: r.text,
        kind: r.kind,
        amount_cents: r.amount_cents,
        related_to: r.related_to,
        logged_at: r.created_at,
      })),
    };
  },
});
