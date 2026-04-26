// Brain tools for the INNER VOICE ATLAS — categorise the user's own self-talk
// into ten voices (critic / dreamer / calculator / frightened / soldier /
// philosopher / victim / coach / comedian / scholar) and surface the WHO
// inside the user that is currently doing most of the speaking. Different
// from §155 (recurring questions) and §156 (commitments) — this is about
// the texture of self-narrative, not the topics or the promises.

import { z } from "zod";
import { defineTool } from "./types";

const VOICES = [
  "critic", "dreamer", "calculator", "frightened", "soldier",
  "philosopher", "victim", "coach", "comedian", "scholar",
] as const;

type Utterance = {
  id: string;
  scan_id: string;
  voice: string;
  excerpt: string;
  gloss: string;
  intensity: number;
  spoken_at: string;
  source_conversation_id: string | null;
  source_message_id: string | null;
  pinned: boolean;
  archived_at: string | null;
  user_note: string | null;
  created_at: string;
};

type LatestScan = {
  id: string;
  window_days: number;
  total_utterances: number;
  dominant_voice: string | null;
  second_voice: string | null;
  voice_counts: Record<string, number>;
  atlas_narrative: string | null;
  created_at: string;
};

export const scanInnerVoiceTool = defineTool({
  name: "scan_inner_voice",
  description: [
    "Run an INNER VOICE ATLAS SCAN — mine the user's own messages and",
    "classify each piece of self-talk into one of ten voices: critic,",
    "dreamer, calculator, frightened, soldier, philosopher, victim,",
    "coach, comedian, scholar. Produces (a) a distribution showing",
    "which voices are dominant, (b) a 2-3 sentence atlas_narrative on",
    "the texture of the user's inner voice, and (c) per-voice receipts.",
    "",
    "Use when the user asks 'who is speaking when I speak to myself',",
    "'what voice do I use most', 'show me my inner voice', 'how do I",
    "talk to myself', or after they've expressed confusion about the",
    "way they think about themselves.",
    "",
    "Optional: window_days (14-365, default 90). Costs an LLM round-trip",
    "(15-30s — bigger payload than other scans). Once a fortnight is",
    "plenty.",
    "",
    "Returns the scan summary + the inserted utterances. The brain",
    "should follow up with list_inner_voice (esp. voice=critic if",
    "critic is dominant) before commenting on the user's self-talk.",
  ].join("\n"),
  schema: z.object({
    window_days: z.number().int().min(14).max(365).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      window_days: { type: "number" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/inner-voice/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(input ?? {}),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `scan failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as {
      scan?: LatestScan;
      inserted?: number;
      latency_ms?: number;
      utterances?: Utterance[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan: j.scan
        ? {
            id: j.scan.id,
            dominant_voice: j.scan.dominant_voice,
            second_voice: j.scan.second_voice,
            total_utterances: j.scan.total_utterances,
            voice_counts: j.scan.voice_counts,
            atlas_narrative: j.scan.atlas_narrative,
            window_days: j.scan.window_days,
          }
        : null,
      inserted: j.inserted ?? 0,
      latency_ms: j.latency_ms,
      signals: j.signals,
      sample: (j.utterances ?? []).slice(0, 8).map((u) => ({
        voice: u.voice,
        intensity: u.intensity,
        excerpt: u.excerpt,
        gloss: u.gloss,
      })),
    };
  },
});

export const listInnerVoiceTool = defineTool({
  name: "list_inner_voice",
  description: [
    "List utterances from the user's latest INNER VOICE ATLAS scan plus",
    "the atlas summary. Optional: voice (critic | dreamer | calculator",
    "| frightened | soldier | philosopher | victim | coach | comedian",
    "| scholar | all, default all), status (live | pinned | archived",
    "| all, default live), limit (default 30, max 200).",
    "",
    "Returns latest_scan ({dominant_voice, second_voice, voice_counts,",
    "atlas_narrative, total_utterances, window_days}) plus the",
    "utterances. The brain should reference the dominant_voice and the",
    "atlas_narrative BEFORE commenting on what the user just said.",
    "Example: 'in your last 90 days, the critic spoke 34% of the time",
    "and that's what I'm hearing now too — want to look at what the",
    "critic was saying back then?'",
    "",
    "If the brain notices the user is currently speaking AS one voice",
    "(e.g. very harsh self-judgement), filtering by that voice surfaces",
    "the receipts of how they sounded last time.",
  ].join("\n"),
  schema: z.object({
    voice: z.enum([...VOICES, "all"]).optional().default("all"),
    status: z.enum(["live", "pinned", "archived", "all"]).optional().default("live"),
    limit: z.number().int().min(1).max(200).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      voice: { type: "string", enum: [...VOICES, "all"] },
      status: { type: "string", enum: ["live", "pinned", "archived", "all"] },
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
    params.set("voice", input.voice ?? "all");
    params.set("status", input.status ?? "live");
    params.set("limit", String(Math.max(1, Math.min(200, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/inner-voice?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as {
      utterances?: Utterance[];
      latest_scan?: LatestScan | null;
      stats?: { total: number; voice_counts: Record<string, number> };
    };
    const rows = j.utterances ?? [];
    return {
      ok: true,
      latest_scan: j.latest_scan
        ? {
            id: j.latest_scan.id,
            dominant_voice: j.latest_scan.dominant_voice,
            second_voice: j.latest_scan.second_voice,
            total_utterances: j.latest_scan.total_utterances,
            voice_counts: j.latest_scan.voice_counts,
            atlas_narrative: j.latest_scan.atlas_narrative,
            window_days: j.latest_scan.window_days,
            scanned_at: j.latest_scan.created_at,
          }
        : null,
      stats: j.stats,
      count: rows.length,
      utterances: rows.map((u) => ({
        id: u.id,
        voice: u.voice,
        intensity: u.intensity,
        excerpt: u.excerpt,
        gloss: u.gloss,
        spoken_at: u.spoken_at,
        pinned: u.pinned,
        archived: u.archived_at != null,
        user_note: u.user_note,
      })),
    };
  },
});

export const respondToInnerVoiceTool = defineTool({
  name: "respond_to_inner_voice",
  description: [
    "Annotate or organise an inner-voice utterance. Specify exactly one mode:",
    "",
    "  note          — attach a user_note (requires note string)",
    "  pin / unpin   — keep visible at the top",
    "  archive / restore — hide / unhide",
    "",
    "Use ONLY when the user has explicitly asked to mark, save, or",
    "annotate a specific utterance. Don't archive on the user's behalf.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    mode: z.enum(["note", "pin", "unpin", "archive", "restore"]),
    note: z.string().min(1).max(800).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "mode"],
    properties: {
      id: { type: "string" },
      mode: { type: "string", enum: ["note", "pin", "unpin", "archive", "restore"] },
      note: { type: "string" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const payload: Record<string, unknown> = {};
    if (input.mode === "note") {
      if (!input.note) return { ok: false, error: "note required for mode=note" };
      payload.user_note = input.note;
    } else if (input.mode === "pin") payload.pin = true;
    else if (input.mode === "unpin") payload.pin = false;
    else if (input.mode === "archive") payload.archive = true;
    else if (input.mode === "restore") payload.restore = true;

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/inner-voice/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { utterance?: Utterance };
    if (!j.utterance) return { ok: false, error: "no row returned" };
    const u = j.utterance;
    return {
      ok: true,
      utterance: {
        id: u.id,
        voice: u.voice,
        excerpt: u.excerpt,
        gloss: u.gloss,
        pinned: u.pinned,
        archived: u.archived_at != null,
        user_note: u.user_note,
      },
    };
  },
});
