// Brain tools for MIND THEATRE (§168) — convene the §167 voice cabinet
// to speak IN CHARACTER on a question or decision the user is sitting
// with. Each voice in the panel produces a stance + a first-person
// reply + a third-person reasoning.
//
// Resolution modes per session:
//   went_with_voice  — name the voice you followed (gives it airtime)
//   self_authored    — override everyone, write your own answer
//   silenced_voice   — consciously refuse a specific voice's vote on
//                      THIS question (nudges that voice toward retire
//                      in the cabinet — the move you can't make in
//                      generic parts-work)
//   unresolved       — sitting with it
//
// The act of running a session externalises the internal noise into a
// readable panel, which is what makes self-authorship possible.

import { z } from "zod";
import { defineTool } from "./types";

type PanelEntry = {
  voice_id: string;
  voice_name: string;
  voice_type: string;
  voice_relation: string | null;
  severity: number;
  airtime: number;
  stance: string;
  reply: string;
  reasoning: string;
};

type Session = {
  id: string;
  question: string;
  context_note: string | null;
  panel: PanelEntry[];
  voices_consulted: number;
  dominant_stance: string | null;
  outcome: string;
  chosen_voice_id: string | null;
  silenced_voice_id: string | null;
  self_authored_answer: string | null;
  decision_note: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
  resolved_at: string | null;
  archived_at: string | null;
};

type Stats = {
  total: number;
  unresolved: number;
  went_with_voice: number;
  self_authored: number;
  silenced_voice: number;
  total_voices_consulted: number;
  top_chosen: { voice_id: string; count: number }[];
  top_silenced: { voice_id: string; count: number }[];
};

export const conveneMindTheatreTool = defineTool({
  name: "convene_mind_theatre",
  description: [
    "Convene the user's voice cabinet (§167) to SPEAK IN CHARACTER on a",
    "question or decision the user is sitting with. Pulls top 5 active",
    "cabinet voices (or a custom subset via voice_ids) and produces a",
    "panel: each voice gives a stance (push/pull/protect/caution/",
    "ambivalent), a 1-3 sentence first-person reply in the voice's own",
    "character, and a one-sentence reasoning describing why this voice",
    "would say that.",
    "",
    "Costs one Haiku call (5-15s).",
    "",
    "Use when the user is wrestling with a decision and naming what they",
    "are sitting with — 'should i', 'i don't know if i should', 'i'm",
    "torn about', 'i can't decide whether to', 'part of me wants but',",
    "'i feel like i should but i don't want to'. Quote the panel back",
    "to the user with each voice's NAME, STANCE, and verbatim REPLY,",
    "then prompt them to resolve via respond_to_mind_theatre_session.",
    "",
    "Requires the cabinet to be populated (run build_voice_cabinet",
    "first if it isn't).",
  ].join("\n"),
  schema: z.object({
    question: z.string().min(4, "question must be at least 4 chars").max(1000),
    context_note: z.string().max(1500).optional(),
    voice_ids: z.array(z.string().uuid()).max(8).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["question"],
    properties: {
      question: { type: "string", description: "What the user is sitting with — a decision, dilemma, or open question. 4-1000 chars." },
      context_note: { type: "string", description: "Optional extra context for the panel." },
      voice_ids: { type: "array", items: { type: "string" }, description: "Optional — restrict the panel to specific cabinet voices by id (max 8). Default: top 5 active voices." },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/mind-theatre/convene`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({
        question: input.question,
        context_note: input.context_note,
        voice_ids: input.voice_ids,
      }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `convene failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { session?: Session; latency_ms?: number };
    const s = j.session;
    if (!s) return { ok: false, error: "no session returned" };
    return {
      ok: true,
      session_id: s.id,
      question: s.question,
      voices_consulted: s.voices_consulted,
      dominant_stance: s.dominant_stance,
      panel: s.panel.map((p) => ({
        voice_id: p.voice_id,
        voice_name: p.voice_name,
        voice_type: p.voice_type,
        voice_relation: p.voice_relation,
        severity: p.severity,
        stance: p.stance,
        reply: p.reply,
        reasoning: p.reasoning,
      })),
      latency_ms: j.latency_ms,
    };
  },
});

export const listMindTheatreTool = defineTool({
  name: "list_mind_theatre",
  description: [
    "List recent Mind Theatre sessions plus stats. Optional filters:",
    "  outcome  (unresolved | went_with_voice | self_authored |",
    "            silenced_voice | all, default all)",
    "  limit    (default 20, max 100)",
    "",
    "Returns sessions + stats including total, per-outcome counts,",
    "top_chosen (which voices the user keeps following) and",
    "top_silenced (which voices the user keeps refusing). Together",
    "these surface a meta-pattern of self-authorship: which voices the",
    "user ratifies vs which they consciously override.",
    "",
    "Use when the user asks 'what have i decided lately', 'which voices",
    "do i keep listening to', 'which voices do i keep refusing', or to",
    "find an unresolved session they want to come back to.",
  ].join("\n"),
  schema: z.object({
    outcome: z.enum(["unresolved", "went_with_voice", "self_authored", "silenced_voice", "all"]).optional().default("all"),
    limit: z.number().int().min(1).max(100).optional().default(20),
  }),
  inputSchema: {
    type: "object",
    properties: {
      outcome: { type: "string", enum: ["unresolved", "went_with_voice", "self_authored", "silenced_voice", "all"] },
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
    if (input.outcome && input.outcome !== "all") params.set("outcome", input.outcome);
    params.set("limit", String(Math.max(1, Math.min(100, input.limit ?? 20))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/mind-theatre?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { sessions?: Session[]; stats?: Stats };
    const rows = j.sessions ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      sessions: rows.map((s) => ({
        id: s.id,
        question: s.question,
        outcome: s.outcome,
        voices_consulted: s.voices_consulted,
        dominant_stance: s.dominant_stance,
        chosen_voice_id: s.chosen_voice_id,
        silenced_voice_id: s.silenced_voice_id,
        self_authored_answer: s.self_authored_answer,
        decision_note: s.decision_note,
        created_at: s.created_at,
        resolved_at: s.resolved_at,
        panel_summary: s.panel.map((p) => ({
          voice_name: p.voice_name,
          stance: p.stance,
          reply: p.reply,
        })),
      })),
    };
  },
});

export const respondToMindTheatreTool = defineTool({
  name: "respond_to_mind_theatre_session",
  description: [
    "Resolve a Mind Theatre session. Specify exactly one mode:",
    "",
    "  went_with_voice  — user is going with one of the panel voices.",
    "                     chosen_voice_id REQUIRED (must be a voice_id",
    "                     from this session's panel). decision_note",
    "                     optional. Bumps that voice's airtime_score in",
    "                     the cabinet by 1.",
    "",
    "  self_authored    — user is overriding all voices and choosing",
    "                     themselves. self_authored_answer REQUIRED.",
    "                     decision_note optional. The clearest sign of",
    "                     self-authorship — push for this when the panel",
    "                     is split and no voice clearly fits.",
    "",
    "  silenced_voice   — user is consciously refusing one voice's vote",
    "                     on THIS question. silenced_voice_id REQUIRED",
    "                     (must be a voice from the panel). decision_note",
    "                     REQUIRED — server rejects empty (this is the",
    "                     reason the voice doesn't get a vote on this",
    "                     specific question, e.g. 'this is mum's voice",
    "                     about money and i'm 33, not 12 — she doesn't",
    "                     get a say on this purchase'). Nudges the voice",
    "                     toward acknowledged in the cabinet. Use this",
    "                     when the user clearly identifies a voice as",
    "                     overstepping on this specific question.",
    "",
    "  unresolved       — return the session to unresolved (clears any",
    "                     previous resolution).",
    "",
    "  archive          — soft-archive the session.",
    "",
    "Use ONLY after the user has explicitly made the call — never resolve",
    "on the user's behalf without their stated choice. Quote the chosen",
    "voice_name (or the silenced voice_name) back so the user sees their",
    "decision named.",
  ].join("\n"),
  schema: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("went_with_voice"),
      session_id: z.string().uuid(),
      chosen_voice_id: z.string().uuid(),
      decision_note: z.string().max(1500).optional(),
    }),
    z.object({
      mode: z.literal("self_authored"),
      session_id: z.string().uuid(),
      self_authored_answer: z.string().min(4).max(2000),
      decision_note: z.string().max(1500).optional(),
    }),
    z.object({
      mode: z.literal("silenced_voice"),
      session_id: z.string().uuid(),
      silenced_voice_id: z.string().uuid(),
      decision_note: z.string().min(4, "decision_note is required when silencing a voice — name why this voice does not get a vote on this question").max(1500),
    }),
    z.object({
      mode: z.literal("unresolved"),
      session_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("archive"),
      session_id: z.string().uuid(),
    }),
  ]),
  inputSchema: {
    type: "object",
    required: ["mode", "session_id"],
    properties: {
      mode: { type: "string", enum: ["went_with_voice", "self_authored", "silenced_voice", "unresolved", "archive"] },
      session_id: { type: "string", description: "id of the Mind Theatre session" },
      chosen_voice_id: { type: "string", description: "REQUIRED for went_with_voice. Must be a voice from the session's panel." },
      silenced_voice_id: { type: "string", description: "REQUIRED for silenced_voice. Must be a voice from the session's panel." },
      self_authored_answer: { type: "string", description: "REQUIRED for self_authored. The user's own answer." },
      decision_note: { type: "string", description: "Optional except for silenced_voice (REQUIRED there) — why this voice does not get a vote on this specific question." },
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
    if (input.mode === "went_with_voice") {
      body.chosen_voice_id = input.chosen_voice_id;
      if (input.decision_note) body.decision_note = input.decision_note;
    } else if (input.mode === "self_authored") {
      body.self_authored_answer = input.self_authored_answer;
      if (input.decision_note) body.decision_note = input.decision_note;
    } else if (input.mode === "silenced_voice") {
      body.silenced_voice_id = input.silenced_voice_id;
      body.decision_note = input.decision_note;
    }

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/mind-theatre/${input.session_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { session?: Session };
    const s = j.session;
    if (!s) return { ok: false, error: "no session returned" };
    return {
      ok: true,
      session_id: s.id,
      outcome: s.outcome,
      chosen_voice_id: s.chosen_voice_id,
      silenced_voice_id: s.silenced_voice_id,
      self_authored_answer: s.self_authored_answer,
      decision_note: s.decision_note,
      resolved_at: s.resolved_at,
      archived_at: s.archived_at,
    };
  },
});
