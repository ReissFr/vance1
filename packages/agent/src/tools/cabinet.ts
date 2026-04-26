// Brain tools for THE VOICE CABINET (§167) — synthesis layer over the
// should ledger. One row per discrete VOICE that authors the user's
// unmet obligations (Mum, Inner Critic, Founder Voice, etc.). Three
// resolution modes per voice: ACKNOWLEDGE (you are heard), INTEGRATE
// (keep the wisdom — name what), RETIRE (you no longer have authority
// over me — name why). Built from the existing shoulds table by
// grouping on obligation_source.
//
// Different from §166 (which mines individual shoulds) — this aggregates
// across all source attributions and lets the user consciously author
// their inner cast.

import { z } from "zod";
import { defineTool } from "./types";

type Voice = {
  id: string;
  scan_id: string;
  voice_name: string;
  voice_type: string;
  voice_relation: string | null;
  typical_phrases: string[];
  typical_obligations: string;
  typical_kinds: string[];
  typical_domains: string[];
  airtime_score: number;
  influence_severity: number;
  charge_average: number | null;
  shoulds_attributed: number;
  used_to_linked: number;
  inheritance_mentions: number;
  first_detected_at: string;
  last_detected_at: string;
  detection_span_days: number;
  confidence: number;
  status: string;
  status_note: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
  updated_at: string;
};

type TypeRanked = { voice_type: string; rows: number; airtime: number; max_severity: number };

type Stats = {
  total: number;
  active: number;
  acknowledged: number;
  integrating: number;
  retired: number;
  dismissed: number;
  high_severity: number;
  inner_critic_active: number;
  parent_active: number;
  total_airtime: number;
  type_counts_ranked: TypeRanked[];
  dominant_voice: { airtime: number; severity: number; voice_type: string } | null;
  most_severe_voice: { airtime: number; severity: number; voice_type: string } | null;
};

export const buildCabinetTool = defineTool({
  name: "build_voice_cabinet",
  description: [
    "Build (or refresh) THE VOICE CABINET — the synthesis layer over",
    "the should ledger. Reads every should attributed to a foreign",
    "source (parent / partner / inner_critic / social_norm /",
    "professional_norm / financial_judge / abstract_other) and",
    "produces ONE row per VOICE: name, relation, typical_obligations,",
    "typical_phrases, airtime_score, influence_severity.",
    "",
    "Different from scan_shoulds (which mines new individual shoulds).",
    "build_voice_cabinet aggregates EXISTING shoulds into voices. Run",
    "AFTER scan_shoulds when the user wants to see WHO authors their",
    "unmet obligations. Re-running refreshes existing voices and adds",
    "any new ones.",
    "",
    "Requires at least 5 shoulds on file. Returns one row per voice",
    "type that has at least 2 shoulds attributed. Costs an LLM call",
    "(5-15s) for naming + relation + distillation.",
    "",
    "Use when the user asks 'whose voice keeps showing up', 'what",
    "voices are running me', 'who's in my head', or after a should",
    "ledger scan when source_counts_ranked shows multiple loud sources.",
    "",
    "The novel resolution path is RETIRE — the user takes authority",
    "back from a voice that is no longer theirs to obey. The cabinet",
    "is a self-authorship surface, not a guilt list.",
  ].join("\n"),
  schema: z.object({}),
  inputSchema: { type: "object", properties: {} },
  async run(_input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/cabinet/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({}),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `cabinet scan failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as {
      scan_id?: string;
      inserted?: number;
      updated?: number;
      latency_ms?: number;
      message?: string;
      voices?: Voice[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      updated: j.updated ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      voices: (j.voices ?? []).map((v) => ({
        id: v.id,
        voice_name: v.voice_name,
        voice_type: v.voice_type,
        voice_relation: v.voice_relation,
        airtime_score: v.airtime_score,
        influence_severity: v.influence_severity,
        charge_average: v.charge_average,
        shoulds_attributed: v.shoulds_attributed,
        confidence: v.confidence,
        status: v.status,
      })),
    };
  },
});

export const listCabinetTool = defineTool({
  name: "list_voice_cabinet",
  description: [
    "List voices in the user's cabinet plus stats. Optional filters:",
    "  status   (active | acknowledged | integrating | retired |",
    "            dismissed | pinned | archived | all, default active)",
    "  type     (parent | partner | inner_critic | social_norm |",
    "            professional_norm | financial_judge | past_self |",
    "            future_self | mentor | abstract_other | all,",
    "            default all)",
    "  min_severity   (1-5, default 1)",
    "  min_confidence (1-5, default 2)",
    "  limit          (default 30, max 100)",
    "",
    "Returns voices + stats including high_severity (severity>=4),",
    "inner_critic_active, parent_active, total_airtime, dominant_voice",
    "(highest airtime), most_severe_voice (highest influence_severity),",
    "and type_counts_ranked (sorted by airtime — WHICH voice types",
    "carry the most weight in the user's head).",
    "",
    "Use when user asks 'who's in my head', 'whose voice is running",
    "me', 'what voices have I retired'. Quote voice_name AND",
    "voice_relation when surfacing — 'Mum's voice (your mother,",
    "internalised)' is more diagnostic than just 'parent'.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["active", "acknowledged", "integrating", "retired", "dismissed", "pinned", "archived", "all"]).optional().default("active"),
    type: z.enum(["parent", "partner", "inner_critic", "social_norm", "professional_norm", "financial_judge", "past_self", "future_self", "mentor", "abstract_other", "all"]).optional().default("all"),
    min_severity: z.number().int().min(1).max(5).optional().default(1),
    min_confidence: z.number().int().min(1).max(5).optional().default(2),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["active", "acknowledged", "integrating", "retired", "dismissed", "pinned", "archived", "all"] },
      type: { type: "string", enum: ["parent", "partner", "inner_critic", "social_norm", "professional_norm", "financial_judge", "past_self", "future_self", "mentor", "abstract_other", "all"] },
      min_severity: { type: "number" },
      min_confidence: { type: "number" },
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
    params.set("status", input.status ?? "active");
    params.set("type", input.type ?? "all");
    params.set("min_severity", String(Math.max(1, Math.min(5, input.min_severity ?? 1))));
    params.set("min_confidence", String(Math.max(1, Math.min(5, input.min_confidence ?? 2))));
    params.set("limit", String(Math.max(1, Math.min(100, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/cabinet?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { voices?: Voice[]; stats?: Stats };
    const rows = j.voices ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      voices: rows.map((v) => ({
        id: v.id,
        voice_name: v.voice_name,
        voice_type: v.voice_type,
        voice_relation: v.voice_relation,
        typical_obligations: v.typical_obligations,
        typical_phrases: (v.typical_phrases ?? []).slice(0, 4),
        typical_kinds: v.typical_kinds,
        typical_domains: v.typical_domains,
        airtime_score: v.airtime_score,
        influence_severity: v.influence_severity,
        charge_average: v.charge_average,
        shoulds_attributed: v.shoulds_attributed,
        confidence: v.confidence,
        status: v.status,
        status_note: v.status_note,
        pinned: v.pinned,
      })),
    };
  },
});

export const respondToVoiceTool = defineTool({
  name: "respond_to_voice",
  description: [
    "Resolve or annotate a voice in the cabinet. Specify exactly one mode:",
    "",
    "  retire        — user is RETIRING this voice. Taking authority",
    "                  back. status_note IS the reason (REQUIRED —",
    "                  server rejects empty). Locks the row to",
    "                  status='retired'. The novel move. Examples:",
    "                    'Mum's voice' -> retire with status_note 'these",
    "                      are my mother's standards, not mine. I do not",
    "                      give them ruling weight any more.'",
    "                    'Founder Voice' -> retire with status_note",
    "                      'this is hustle culture I absorbed. I work",
    "                      plenty by my own standards.'",
    "  integrate     — user is keeping the wisdom but leaving the",
    "                  pressure. status_note IS what wisdom + what",
    "                  pressure (REQUIRED — server rejects empty).",
    "                  Examples:",
    "                    'Inner Critic' -> integrate with status_note",
    "                      'I keep the high standard for craft. I leave",
    "                      the self-flagellation when I miss it.'",
    "  acknowledge   — user has heard the voice. No commitment to",
    "                  retire or integrate yet. Optional status_note.",
    "  dismiss       — false positive (the voice attribution was",
    "                  wrong). Optional status_note.",
    "  pin / unpin       — keep visible.",
    "  archive / restore — hide / unhide.",
    "",
    "The retire move is the load-bearing one. Most therapy traditions",
    "name the voice but don't surface a 'take authority back' button.",
    "When voice_type is parent / social_norm / inner_critic — STRONGLY",
    "consider that retire might be the right move. The user has been",
    "carrying these voices their whole life and naming the option to",
    "retire is itself the intervention.",
    "",
    "When integrating, the brain should PUSH for the SPLIT — what",
    "WISDOM stays, what PRESSURE goes. Vague 'I'll think about it'",
    "is not an integration.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    mode: z.enum(["retire", "integrate", "acknowledge", "dismiss", "pin", "unpin", "archive", "unarchive"]),
    status_note: z.string().min(1).max(2000).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "mode"],
    properties: {
      id: { type: "string" },
      mode: { type: "string", enum: ["retire", "integrate", "acknowledge", "dismiss", "pin", "unpin", "archive", "unarchive"] },
      status_note: { type: "string" },
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
    if (input.mode === "retire") {
      if (!input.status_note || input.status_note.trim().length === 0) {
        return { ok: false, error: "retire mode requires status_note (why this voice no longer rules the user)" };
      }
      payload.status = "retired";
      payload.status_note = input.status_note;
    } else if (input.mode === "integrate") {
      if (!input.status_note || input.status_note.trim().length === 0) {
        return { ok: false, error: "integrate mode requires status_note (what wisdom is kept and what pressure is left behind)" };
      }
      payload.status = "integrating";
      payload.status_note = input.status_note;
    } else if (input.mode === "acknowledge") {
      payload.status = "acknowledged";
      if (input.status_note) payload.status_note = input.status_note;
    } else if (input.mode === "dismiss") {
      payload.status = "dismissed";
      if (input.status_note) payload.status_note = input.status_note;
    } else if (input.mode === "pin") payload.pin = true;
    else if (input.mode === "unpin") payload.pin = false;
    else if (input.mode === "archive") payload.archive = true;
    else if (input.mode === "unarchive") payload.restore = true;

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/cabinet/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { voice?: Voice };
    if (!j.voice) return { ok: false, error: "no row returned" };
    const v = j.voice;
    return {
      ok: true,
      voice: {
        id: v.id,
        voice_name: v.voice_name,
        voice_type: v.voice_type,
        voice_relation: v.voice_relation,
        status: v.status,
        status_note: v.status_note,
        airtime_score: v.airtime_score,
        influence_severity: v.influence_severity,
        pinned: v.pinned,
        archived: v.archived_at != null,
      },
    };
  },
});
