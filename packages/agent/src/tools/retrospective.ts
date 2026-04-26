// Brain tool for the retrospective synthesis. Pulls wins, reflections,
// decisions, blockers, and intentions across a date range and returns the
// merged chronological feed. The brain uses this for weekly reviews,
// "what did I get done this week", "what kept blocking me last month",
// "summarise the past 30 days" — instead of calling 5 separate tools.

import { z } from "zod";
import { defineTool } from "./types";

type Item = {
  kind: "win" | "reflection" | "decision" | "blocker" | "intention";
  subkind: string | null;
  date: string;
  iso: string;
  title?: string | null;
  body: string;
  tags?: string[];
  amount_cents?: number | null;
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}

function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

export const weeklySynthesisTool = defineTool({
  name: "weekly_synthesis",
  description: [
    "Pull a unified retrospective across the user's journal layers — wins,",
    "reflections (lessons/regrets/realisations/observations/gratitude),",
    "decisions made, blockers from standups, and daily intentions — within a",
    "date range (default 7 days, max 90). Returns chronological items + counts",
    "per kind + total amount logged in wins. Use for weekly/monthly reviews,",
    "'what did I get done', 'what kept blocking me', 'summarise the past N",
    "days'. One call instead of five.",
  ].join("\n"),
  schema: z.object({
    days: z.number().int().min(1).max(90).optional(),
    kinds: z
      .array(z.enum(["win", "reflection", "decision", "blocker", "intention"]))
      .optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      days: { type: "number", description: "lookback window in days (default 7, max 90)" },
      kinds: {
        type: "array",
        items: { type: "string", enum: ["win", "reflection", "decision", "blocker", "intention"] },
        description: "Optional filter — restrict to these kinds",
      },
    },
  },
  async run(input, ctx) {
    const days = input.days ?? 7;
    const sinceDate = new Date(Date.now() - days * 86400000);
    const sinceIso = sinceDate.toISOString();
    const sinceYmd = ymd(sinceDate);
    const filter = new Set(
      input.kinds && input.kinds.length > 0
        ? input.kinds
        : (["win", "reflection", "decision", "blocker", "intention"] as Item["kind"][]),
    );

    const items: Item[] = [];
    let winAmountCents = 0;

    if (filter.has("win")) {
      const { data } = await ctx.supabase
        .from("wins")
        .select("id, text, kind, amount_cents, created_at")
        .eq("user_id", ctx.userId)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false });
      for (const w of (data ?? []) as Array<{
        id: string;
        text: string;
        kind: string;
        amount_cents: number | null;
        created_at: string;
      }>) {
        items.push({
          kind: "win",
          subkind: w.kind,
          date: dateKey(w.created_at),
          iso: w.created_at,
          body: w.text,
          amount_cents: w.amount_cents,
        });
        if (typeof w.amount_cents === "number") winAmountCents += w.amount_cents;
      }
    }

    if (filter.has("reflection")) {
      const { data } = await ctx.supabase
        .from("reflections")
        .select("id, text, kind, tags, created_at")
        .eq("user_id", ctx.userId)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false });
      for (const r of (data ?? []) as Array<{
        id: string;
        text: string;
        kind: string;
        tags: string[];
        created_at: string;
      }>) {
        items.push({
          kind: "reflection",
          subkind: r.kind,
          date: dateKey(r.created_at),
          iso: r.created_at,
          body: r.text,
          tags: r.tags,
        });
      }
    }

    if (filter.has("decision")) {
      const { data } = await ctx.supabase
        .from("decisions")
        .select("id, title, choice, outcome_label, created_at, reviewed_at")
        .eq("user_id", ctx.userId)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false });
      for (const d of (data ?? []) as Array<{
        id: string;
        title: string;
        choice: string;
        outcome_label: string | null;
        created_at: string;
        reviewed_at: string | null;
      }>) {
        items.push({
          kind: "decision",
          subkind: d.outcome_label ?? (d.reviewed_at ? "reviewed" : "open"),
          date: dateKey(d.created_at),
          iso: d.created_at,
          title: d.title,
          body: d.choice,
        });
      }
    }

    if (filter.has("blocker")) {
      const { data } = await ctx.supabase
        .from("standups")
        .select("id, log_date, blockers")
        .eq("user_id", ctx.userId)
        .gte("log_date", sinceYmd)
        .not("blockers", "is", null)
        .order("log_date", { ascending: false });
      for (const s of (data ?? []) as Array<{
        id: string;
        log_date: string;
        blockers: string | null;
      }>) {
        if (s.blockers && s.blockers.trim()) {
          items.push({
            kind: "blocker",
            subkind: null,
            date: s.log_date,
            iso: `${s.log_date}T08:00:00.000Z`,
            body: s.blockers.trim(),
          });
        }
      }
    }

    if (filter.has("intention")) {
      const { data } = await ctx.supabase
        .from("intentions")
        .select("id, log_date, text, completed_at")
        .eq("user_id", ctx.userId)
        .gte("log_date", sinceYmd)
        .order("log_date", { ascending: false });
      for (const it of (data ?? []) as Array<{
        id: string;
        log_date: string;
        text: string;
        completed_at: string | null;
      }>) {
        items.push({
          kind: "intention",
          subkind: it.completed_at ? "completed" : "set",
          date: it.log_date,
          iso: `${it.log_date}T07:00:00.000Z`,
          body: it.text,
        });
      }
    }

    items.sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0));

    const counts: Record<string, number> = {};
    for (const it of items) counts[it.kind] = (counts[it.kind] ?? 0) + 1;

    return {
      ok: true,
      days,
      since: sinceYmd,
      counts,
      win_amount_cents: winAmountCents,
      items,
    };
  },
});
