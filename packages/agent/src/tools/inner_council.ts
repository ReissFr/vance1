// Brain tools for the inner council. The user asks one question and gets
// answers in parallel from six "voices of themselves":
//   - past_self_1y: them, exactly one year ago, conditioned on a 60-day
//     window of their own writing leading up to that anchor
//   - future_self_5y: them, five years from now, conditioned on what they
//     said they were becoming + their open goals + active themes
//   - values_self: them at their most principled, conditioned ONLY on
//     their stated values, refusals, and constitution articles
//   - ambitious_self: them leaning forward, conditioned on open goals,
//     active themes, and their 12-month trajectory snapshot
//   - tired_self: them at low ebb, conditioned on low-energy check-ins,
//     blockers, parked priority questions, and open commitments
//   - wise_self: their accumulated lessons / regrets / realisations
//
// Use when the user wants more than one voice on a hard question — when
// they say "what do all sides of me say about this", "convene a council",
// "I need to hear from past me AND values me on this", or before any
// decision big enough that one perspective is not enough.

import { z } from "zod";
import { defineTool } from "./types";

type VoiceKey =
  | "past_self_1y"
  | "future_self_5y"
  | "values_self"
  | "ambitious_self"
  | "tired_self"
  | "wise_self";

type CouncilVoiceRow = {
  id: string;
  voice: VoiceKey;
  content: string;
  confidence: number;
  starred: boolean;
  source_kinds: string[];
  source_count: number;
  latency_ms: number | null;
  created_at: string;
};

type CouncilSessionRow = {
  id: string;
  question: string;
  synthesis_note: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type ConveneResponse = {
  session?: CouncilSessionRow;
  voices?: CouncilVoiceRow[];
  errors?: Array<{ voice: VoiceKey; error: string }>;
};

const ALL_VOICES: VoiceKey[] = [
  "past_self_1y",
  "future_self_5y",
  "values_self",
  "ambitious_self",
  "tired_self",
  "wise_self",
];

export const conveneInnerCouncilTool = defineTool({
  name: "convene_inner_council",
  description: [
    "Ask one question to up to six voices of the user, in parallel, each",
    "grounded in a different slice of their own writing. Returns every",
    "voice's reply (2-4 short paragraphs), the source kinds each voice",
    "used, and the persisted session id (so the user can synthesise on",
    "/inner-council).",
    "",
    "Voices: past_self_1y (the user one year ago), future_self_5y (the",
    "user five years from now), values_self (their stated values +",
    "refusals only), ambitious_self (open goals + active themes + 12-",
    "month trajectory), tired_self (low-energy check-ins, blockers,",
    "parked questions, open commitments), wise_self (lessons, regrets,",
    "realisations).",
    "",
    "Required: question. Optional: voices (subset of the six keys; default",
    "= all six). Persists the session and every reply.",
    "",
    "Use when the user says 'convene the council', 'ask all of me',",
    "'what do every side of me say', 'I need a real deliberation', or",
    "before any decision big enough that a single perspective feels",
    "thin. Prefer this over plain ask_past_self / ask_future_self when",
    "more than one voice is wanted.",
  ].join("\n"),
  schema: z.object({
    question: z.string().min(4).max(4000),
    voices: z
      .array(
        z.enum([
          "past_self_1y",
          "future_self_5y",
          "values_self",
          "ambitious_self",
          "tired_self",
          "wise_self",
        ]),
      )
      .min(1)
      .max(6)
      .optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["question"],
    properties: {
      question: { type: "string" },
      voices: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "past_self_1y",
            "future_self_5y",
            "values_self",
            "ambitious_self",
            "tired_self",
            "wise_self",
          ],
        },
      },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) {
      return { ok: false, error: "no session token; ask the user to open /inner-council" };
    }

    const payload: Record<string, unknown> = { question: input.question };
    if (input.voices && input.voices.length > 0) payload.voices = input.voices;

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/inner-council`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `council failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as ConveneResponse;
    if (!j.session || !Array.isArray(j.voices) || j.voices.length === 0) {
      return { ok: false, error: "no voices returned" };
    }
    return {
      ok: true,
      session_id: j.session.id,
      replies: j.voices.map((v) => ({
        voice: v.voice,
        content: v.content,
        confidence: v.confidence,
        source_kinds: v.source_kinds,
        source_count: v.source_count,
      })),
      failed_voices: j.errors ?? [],
    };
  },
});

export const listInnerCouncilSessionsTool = defineTool({
  name: "list_inner_council_sessions",
  description: [
    "List the user's stored inner-council sessions (newest first).",
    "Optional: status (active | pinned | archived | all, default active);",
    "limit (default 10). Returns id, question, synthesis_note (the user's",
    "own answer after hearing the voices), pinned flag, and timestamps.",
    "",
    "Use when the user references a past council session ('open that",
    "council I ran on the move-vs-stay question', 'what was my synthesis",
    "on that one') or when surveying recent deliberations.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["active", "pinned", "archived", "all"]).optional().default("active"),
    limit: z.number().int().min(1).max(100).optional().default(10),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["active", "pinned", "archived", "all"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "active";
    const limit = input.limit ?? 10;
    let q = ctx.supabase
      .from("inner_council_sessions")
      .select("id, question, synthesis_note, pinned, archived_at, created_at, updated_at")
      .eq("user_id", ctx.userId);
    if (status === "active") q = q.is("archived_at", null);
    else if (status === "archived") q = q.not("archived_at", "is", null);
    else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
    q = q
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as CouncilSessionRow[];
    return {
      ok: true,
      count: rows.length,
      sessions: rows.map((r) => ({
        id: r.id,
        question: r.question,
        synthesis_note: r.synthesis_note,
        pinned: r.pinned,
        updated_at: r.updated_at,
        created_at: r.created_at,
      })),
    };
  },
});

export const recordInnerCouncilSynthesisTool = defineTool({
  name: "record_inner_council_synthesis",
  description: [
    "Record the user's synthesis note on an inner-council session — i.e.",
    "their own answer after hearing all the voices ('having heard them",
    "all, what do you actually think'). Overwrites any existing note.",
    "Pass an empty string to clear it.",
    "",
    "Use when the user says 'note that I'm going to X', 'my synthesis",
    "is...', 'mark my decision on that council session as...', or after",
    "the brain has helped them weigh the voices and they want the",
    "outcome saved.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    synthesis_note: z.string().max(4000),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "synthesis_note"],
    properties: {
      id: { type: "string" },
      synthesis_note: { type: "string" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) {
      return { ok: false, error: "no session token; ask the user to open /inner-council" };
    }
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/inner-council/${input.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ synthesis_note: input.synthesis_note }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `synthesis save failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { session?: CouncilSessionRow };
    return {
      ok: true,
      session: j.session
        ? {
            id: j.session.id,
            synthesis_note: j.session.synthesis_note,
            updated_at: j.session.updated_at,
          }
        : null,
    };
  },
});

// Keep ALL_VOICES exported for parity with other modules (unused locally
// but documents the canonical list).
export { ALL_VOICES };
