// Brain tools for THE LETTERS ACROSS TIME ARCHIVE (§173).
//
// A letter is a piece of self-correspondence sent across time. Three
// directions:
//   to_future_self  — delivered on target_date via cron (the slow burn)
//   to_past_self    — addressed to who you were on target_date in the past
//   to_younger_self — addressed to a much younger you
//
// The novel hook: every letter captures a STATE-VECTOR SNAPSHOT at compose
// time (active vows + shoulds + imagined-futures + recent thresholds +
// chat themes + conversation count over 30d). Letters TO the past also
// carry an INFERRED snapshot of who the recipient was — reconstructed
// from chat history at the target date, ±30d window. Most journalling
// tools that offer "letter to your younger self" give you a textbox and
// a date. This one delivers the letter alongside proof of who you were.

import { z } from "zod";
import { defineTool } from "./types";

type Snapshot = Record<string, unknown>;

type Letter = {
  id: string;
  letter_text: string;
  direction: "to_future_self" | "to_past_self" | "to_younger_self";
  target_date: string;
  title: string | null;
  prompt_used: string | null;
  author_state_snapshot: Snapshot | null;
  target_state_snapshot: Snapshot | null;
  status: "scheduled" | "delivered" | "archived";
  delivered_at: string | null;
  pinned: boolean;
  delivery_channels: Snapshot | null;
  created_at: string;
  updated_at: string;
};

type Stats = {
  total: number;
  scheduled: number;
  delivered: number;
  archived: number;
  to_future_self: number;
  to_past_self: number;
  to_younger_self: number;
  pinned: number;
  next_scheduled: { id: string; target_date: string } | null;
  most_recent_delivered: { id: string; delivered_at: string } | null;
};

export const composeLetterTool = defineTool({
  name: "compose_letter",
  description: [
    "Compose a letter across time. THREE DIRECTIONS:",
    "",
    "  to_future_self  — letter delivered on target_date via cron. Use",
    "                    when the user wants to leave a message for who",
    "                    they'll be in 6 months / 1 year / 5 years. The",
    "                    target_date MUST be in the future. The letter",
    "                    is captured with a state-vector snapshot of who",
    "                    the user is RIGHT NOW so future-them reads not",
    "                    just the words but the state of self that wrote",
    "                    them.",
    "",
    "  to_past_self    — letter addressed to who the user was on a",
    "                    specific past date. Use when the user wants to",
    "                    write to themselves at a particular moment ('to",
    "                    me, the day after I quit'). The target_date MUST",
    "                    be in the past. The system also captures an",
    "                    INFERRED state-vector snapshot of who the user",
    "                    was at target_date (extracted from chat history",
    "                    in a ±30d window: vows/shoulds/imagined-futures",
    "                    spoken in that period, themes, conversation",
    "                    count).",
    "",
    "  to_younger_self — letter addressed to a much-younger user. Use",
    "                    when the user wants to write to a previous era",
    "                    of themselves ('to me at 18', 'to the kid at",
    "                    summer camp'). Same target-snapshot inference",
    "                    applies but data may be sparse for very old",
    "                    target_dates — the snapshot will note this.",
    "",
    "Required: letter_text (50-8000 chars), direction, target_date (ISO",
    "yyyy-mm-dd). Optional: title (4-120), prompt_used (4-240 — the",
    "question or frame that nudged the letter, e.g. 'what would I want",
    "her to know?').",
    "",
    "Use when the user asks to write a letter to themselves, when they",
    "want to capture how they feel right now for future-them, when they",
    "want to address a past version of themselves, or as a natural",
    "follow-on to a §165 used-to scan ('write a letter to who you were",
    "before you stopped doing X'), §171 imagined-futures ('write a letter",
    "to who you'll be if you pursue this'), or §172 vows ('write a letter",
    "to who you were when you made this vow'). Don't auto-compose without",
    "user content — letters need the user's actual words.",
  ].join("\n"),
  schema: z.object({
    letter_text: z.string().min(50).max(8000),
    direction: z.enum(["to_future_self", "to_past_self", "to_younger_self"]),
    target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "target_date must be ISO yyyy-mm-dd"),
    title: z.string().min(4).max(120).optional(),
    prompt_used: z.string().min(4).max(240).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["letter_text", "direction", "target_date"],
    properties: {
      letter_text: { type: "string", description: "The letter body, 50-8000 chars." },
      direction: { type: "string", enum: ["to_future_self", "to_past_self", "to_younger_self"] },
      target_date: { type: "string", description: "ISO yyyy-mm-dd. For to_future_self: in the future (delivery date). For to_past_self / to_younger_self: in the past (date the recipient was at)." },
      title: { type: "string" },
      prompt_used: { type: "string", description: "The prompt or question that nudged this letter." },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/letters/compose`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({
        letter_text: input.letter_text,
        direction: input.direction,
        target_date: input.target_date,
        title: input.title,
        prompt_used: input.prompt_used,
      }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `compose failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { letter?: Letter };
    const l = j.letter;
    if (!l) return { ok: false, error: "no letter returned" };
    return {
      ok: true,
      letter_id: l.id,
      direction: l.direction,
      target_date: l.target_date,
      status: l.status,
      title: l.title,
      author_snapshot_present: !!l.author_state_snapshot,
      target_snapshot_present: !!l.target_state_snapshot,
    };
  },
});

export const listLettersTool = defineTool({
  name: "list_letters",
  description: [
    "List letters across time. Filters:",
    "  direction (to_future_self | to_past_self | to_younger_self | all)",
    "  status    (active | scheduled | delivered | pinned | archived | all,",
    "             default active)",
    "  limit     (default 30, max 200)",
    "",
    "Returns letters + stats including next_scheduled (the next future",
    "letter due to be delivered) and most_recent_delivered.",
    "",
    "Use when the user asks 'what letters have I written', 'when's my",
    "next letter due', 'show me letters to my younger self', or as part",
    "of a reflection prompt ('here's what you wrote to yourself a year",
    "ago').",
    "",
    "Each letter carries its full author_state_snapshot and (where",
    "applicable) target_state_snapshot. When surfacing a letter, READ",
    "ALONGSIDE the snapshot — the snapshot is the diagnostic value, the",
    "evidence of who the user was when they wrote it.",
  ].join("\n"),
  schema: z.object({
    direction: z.enum(["to_future_self", "to_past_self", "to_younger_self", "all"]).optional().default("all"),
    status: z.enum(["active", "scheduled", "delivered", "pinned", "archived", "all"]).optional().default("active"),
    limit: z.number().int().min(1).max(200).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      direction: { type: "string", enum: ["to_future_self", "to_past_self", "to_younger_self", "all"] },
      status: { type: "string", enum: ["active", "scheduled", "delivered", "pinned", "archived", "all"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const params = new URLSearchParams();
    if (input.direction) params.set("direction", input.direction);
    if (input.status) params.set("status", input.status);
    params.set("limit", String(Math.max(1, Math.min(200, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/letters?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { letters?: Letter[]; stats?: Stats };
    const rows = j.letters ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      letters: rows.map((l) => ({
        id: l.id,
        direction: l.direction,
        target_date: l.target_date,
        title: l.title,
        prompt_used: l.prompt_used,
        status: l.status,
        delivered_at: l.delivered_at,
        pinned: l.pinned,
        // truncated to keep the brain context lean — full text via
        // separate retrieval if needed
        letter_text_preview: l.letter_text.length > 400 ? `${l.letter_text.slice(0, 400)}…` : l.letter_text,
        author_snapshot: l.author_state_snapshot,
        target_snapshot: l.target_state_snapshot,
      })),
    };
  },
});

export const respondToLetterTool = defineTool({
  name: "respond_to_letter",
  description: [
    "Pin, archive, deliver-now, or edit a letter. Specify exactly one mode:",
    "  pin / unpin     — toggle pinned (pinned letters surface as",
    "                    shortcuts).",
    "  archive / restore — soft-archive / restore a letter.",
    "  deliver_now     — for to_future_self letters in scheduled status:",
    "                    deliver early. Use when the user explicitly asks",
    "                    to read the letter before its scheduled date.",
    "  edit            — fix the title or letter_text. At least one",
    "                    field required. The state-vector snapshots are",
    "                    NOT re-captured by edit (they remain pinned to",
    "                    the original write moment).",
    "",
    "Use ONLY when the user has stated a clear intent. Don't auto-deliver",
    "or auto-archive; let the user decide. The author_state_snapshot is",
    "frozen at compose time — editing the letter text doesn't update it.",
  ].join("\n"),
  schema: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("pin"), letter_id: z.string().uuid() }),
    z.object({ mode: z.literal("unpin"), letter_id: z.string().uuid() }),
    z.object({ mode: z.literal("archive"), letter_id: z.string().uuid() }),
    z.object({ mode: z.literal("restore"), letter_id: z.string().uuid() }),
    z.object({ mode: z.literal("deliver_now"), letter_id: z.string().uuid() }),
    z.object({
      mode: z.literal("edit"),
      letter_id: z.string().uuid(),
      title: z.string().max(120).optional(),
      letter_text: z.string().min(50).max(8000).optional(),
    }),
  ]),
  inputSchema: {
    type: "object",
    required: ["mode", "letter_id"],
    properties: {
      mode: { type: "string", enum: ["pin", "unpin", "archive", "restore", "deliver_now", "edit"] },
      letter_id: { type: "string" },
      title: { type: "string" },
      letter_text: { type: "string" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const body: Record<string, unknown> = { mode: input.mode };
    if (input.mode === "edit") {
      if (typeof input.title === "string") body.title = input.title;
      if (input.letter_text) body.letter_text = input.letter_text;
    }

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/letters/${input.letter_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { letter?: Letter };
    const l = j.letter;
    if (!l) return { ok: false, error: "no letter returned" };
    return {
      ok: true,
      letter_id: l.id,
      direction: l.direction,
      target_date: l.target_date,
      title: l.title,
      status: l.status,
      pinned: l.pinned,
      delivered_at: l.delivered_at,
    };
  },
});
