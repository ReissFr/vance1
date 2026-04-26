// Brain tools for THE ALMOST-REGISTER (§170) — mining moments where the
// user typed something that named ALMOST doing or saying something but
// pulled back at the last second. Mirror of §169 thresholds: where
// thresholds catalogue identity-crossings the user DID make, almosts
// catalogue the ones they ALMOST made and pulled back from.
//
// The novel hook: regret_tilt. Same surface phrase ('I almost quit')
// can mean RELIEF (thank god I didn't — the brake was wisdom) or
// REGRET (I wish I had — the brake was fear). Naming the difference
// IS the move.
//
// The novel resolution: retry. Converts a past near-miss into a
// PRESENT commitment. The user states what they're now committing to
// and the system records the conversion. This is what makes the
// register active rather than archival.

import { z } from "zod";
import { defineTool } from "./types";

type Almost = {
  id: string;
  scan_id: string;
  act_text: string;
  pulled_back_by: string;
  consequence_imagined: string | null;
  kind: string;
  domain: string;
  weight: number;
  recency: string;
  regret_tilt: string;
  confidence: number;
  spoken_date: string;
  spoken_message_id: string | null;
  conversation_id: string | null;
  status: string;
  status_note: string | null;
  retry_intention_id: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
  updated_at: string;
};

type Stats = {
  total: number;
  active: number;
  honoured: number;
  mourned: number;
  retried: number;
  dismissed: number;
  pinned: number;
  relief: number;
  regret: number;
  mixed: number;
  high_weight: number;
  regret_active: number;
  relief_honoured: number;
  regret_retried: number;
  kind_counts: Record<string, number>;
  tilt_by_kind: Record<string, { relief: number; regret: number; mixed: number }>;
  most_recent_regret: { id: string; spoken_date: string } | null;
  biggest_relief: { id: string; spoken_date: string; weight: number } | null;
  biggest_regret: { id: string; spoken_date: string; weight: number } | null;
};

export const scanAlmostsTool = defineTool({
  name: "scan_almosts",
  description: [
    "Mine the user's chats for NEAR-MISSES — moments they named ALMOST",
    "doing or saying something but pulled back at the last second.",
    "Triggers: 'I almost X', 'I was about to X but', 'I nearly', 'I",
    "started typing but deleted', 'I drafted the reply but didn't send',",
    "'I picked up the phone and put it down', 'stopped myself', 'talked",
    "myself out of', 'chickened out', 'backed out at the last minute'.",
    "",
    "For each near-miss captures: verbatim act_text, distilled",
    "pulled_back_by (what stopped you), optional consequence_imagined,",
    "kind (reaching_out/saying_no/leaving/staying/starting/quitting/",
    "spending/refusing/confronting/asking/confessing/other), domain,",
    "weight 1-5 (how close you came), recency, regret_tilt, confidence.",
    "",
    "The novel signal is REGRET_TILT — relief vs regret vs mixed. The",
    "same surface phrase 'I almost quit' can mean RELIEF (thank god I",
    "didn't, the brake was wisdom) or REGRET (I wish I had, the brake",
    "was fear). Read the tone. Naming the difference is the diagnostic",
    "that turns a passing utterance into self-knowledge.",
    "",
    "Costs an LLM call (10-25s). Default window 180 days; expand to 365",
    "or 730 if surfacing older near-misses. Dedups by spoken_message_id.",
    "",
    "Use when the user asks 'what did I almost do', 'what did I pull",
    "back from', 'what do I keep nearly doing', 'where am I chickening",
    "out', 'what near-misses do I keep noticing', or as the natural",
    "complement to a thresholds scan (what I crossed vs what I almost",
    "crossed and didn't).",
  ].join("\n"),
  schema: z.object({
    window_days: z.number().int().min(30).max(730).optional().default(180),
  }),
  inputSchema: {
    type: "object",
    properties: {
      window_days: { type: "number", description: "Window in days (30-730, default 180)" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/almosts/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ window_days: input.window_days ?? 180 }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `almost scan failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as {
      scan_id?: string;
      inserted?: number;
      latency_ms?: number;
      message?: string;
      almosts?: Almost[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      almosts: (j.almosts ?? []).map((a) => ({
        id: a.id,
        act_text: a.act_text,
        pulled_back_by: a.pulled_back_by,
        consequence_imagined: a.consequence_imagined,
        kind: a.kind,
        domain: a.domain,
        weight: a.weight,
        recency: a.recency,
        regret_tilt: a.regret_tilt,
        confidence: a.confidence,
        spoken_date: a.spoken_date,
      })),
    };
  },
});

export const listAlmostsTool = defineTool({
  name: "list_almosts",
  description: [
    "List near-misses in the user's register plus stats. Filters:",
    "  status        (active | honoured | mourned | retried | dismissed |",
    "                 pinned | archived | all, default active)",
    "  kind          (reaching_out | saying_no | leaving | staying |",
    "                 starting | quitting | spending | refusing |",
    "                 confronting | asking | confessing | other | all)",
    "  regret_tilt   (relief | regret | mixed | all)",
    "  min_weight    (1-5, default 1)",
    "  min_confidence(1-5, default 2)",
    "  limit         (default 30, max 200)",
    "",
    "Returns near-misses + stats including relief / regret / mixed",
    "counts, high_weight (weight>=4 finger-on-trigger near-misses),",
    "regret_active (active near-misses tilted regret — flag for",
    "attention; these are the ones the user pulled back on but wishes",
    "they hadn't), relief_honoured (relief tilts the user has owned as",
    "wisdom), regret_retried (regret tilts the user has converted into",
    "present commitments — the active register), kind_counts,",
    "tilt_by_kind, most_recent_regret, biggest_relief (largest brake",
    "the user is glad they pulled), biggest_regret (largest brake the",
    "user wishes they hadn't pulled — the strongest candidate for retry).",
    "",
    "Use when the user asks 'what did I almost do', 'what near-misses",
    "have I logged', 'where do I keep chickening out', 'what regrets",
    "am I sitting with', or as ID-evidence retrieval when surfacing",
    "the gap between intention and action.",
    "",
    "When surfacing, QUOTE the act_text verbatim and read the",
    "pulled_back_by aloud — the diagnostic value is in seeing what",
    "specific brake came on, not the abstract kind.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["active", "honoured", "mourned", "retried", "dismissed", "pinned", "archived", "all"]).optional().default("active"),
    kind: z.enum(["reaching_out", "saying_no", "leaving", "staying", "starting", "quitting", "spending", "refusing", "confronting", "asking", "confessing", "other", "all"]).optional().default("all"),
    regret_tilt: z.enum(["relief", "regret", "mixed", "all"]).optional().default("all"),
    min_weight: z.number().int().min(1).max(5).optional().default(1),
    min_confidence: z.number().int().min(1).max(5).optional().default(2),
    limit: z.number().int().min(1).max(200).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["active", "honoured", "mourned", "retried", "dismissed", "pinned", "archived", "all"] },
      kind: { type: "string", enum: ["reaching_out", "saying_no", "leaving", "staying", "starting", "quitting", "spending", "refusing", "confronting", "asking", "confessing", "other", "all"] },
      regret_tilt: { type: "string", enum: ["relief", "regret", "mixed", "all"] },
      min_weight: { type: "number" },
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
    params.set("kind", input.kind ?? "all");
    params.set("regret_tilt", input.regret_tilt ?? "all");
    params.set("min_weight", String(Math.max(1, Math.min(5, input.min_weight ?? 1))));
    params.set("min_confidence", String(Math.max(1, Math.min(5, input.min_confidence ?? 2))));
    params.set("limit", String(Math.max(1, Math.min(200, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/almosts?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { almosts?: Almost[]; stats?: Stats };
    const rows = j.almosts ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      almosts: rows.map((a) => ({
        id: a.id,
        act_text: a.act_text,
        pulled_back_by: a.pulled_back_by,
        consequence_imagined: a.consequence_imagined,
        kind: a.kind,
        domain: a.domain,
        weight: a.weight,
        recency: a.recency,
        regret_tilt: a.regret_tilt,
        confidence: a.confidence,
        status: a.status,
        status_note: a.status_note,
        spoken_date: a.spoken_date,
        pinned: a.pinned,
      })),
    };
  },
});

export const respondToAlmostTool = defineTool({
  name: "respond_to_almost",
  description: [
    "Resolve, edit, or annotate a near-miss. Specify exactly one mode:",
    "",
    "  honour  — user is owning the brake as wisdom. status_note IS",
    "            what made the brake right (REQUIRED — server rejects",
    "            empty). Examples:",
    "              'I almost replied to my ex' -> honour with status_note",
    "                'I'm glad I didn't. The brake was self-respect, not",
    "                fear. The line stands.'",
    "              'I almost bought the £400 jacket' -> honour with note",
    "                'the brake was the budget I'd set on Sunday. It",
    "                worked.'",
    "",
    "  mourn   — user judges the brake was a self-betrayal. status_note",
    "            IS what they'd want back (REQUIRED — server rejects",
    "            empty). Examples:",
    "              'I almost asked her to dinner' -> mourn with note",
    "                'I let fear stop me. I want to be the kind of",
    "                person who asks. I'd want the chance back.'",
    "",
    "  retry   — THE NOVEL MOVE. Convert this past near-miss into a",
    "            PRESENT commitment. status_note IS the action the user",
    "            is taking forward NOW (REQUIRED — server rejects empty).",
    "            Examples:",
    "              'I almost messaged the investor' -> retry with note",
    "                'I'm sending the message today. Drafted, sent before",
    "                end of day.'",
    "              'I drafted the resignation' -> retry with note",
    "                'I'm having the conversation with my manager this",
    "                week to renegotiate the role.'",
    "            Use retry when the regret_tilt is regret AND the user",
    "            has named what they're committing to RIGHT NOW. Don't",
    "            use retry as wishful 'maybe one day'. The whole point",
    "            is the bridge from near-miss to present action.",
    "",
    "  dismiss — false alarm / mis-extraction by the model. status_note",
    "            optional.",
    "",
    "  unresolve — return to active (clear resolution).",
    "  pin / unpin — toggle pinned (pinned near-misses surface as",
    "                shortcuts when relevant).",
    "  archive / restore.",
    "",
    "  edit    — fix mis-extracted facts. Optional fields: act_text,",
    "            pulled_back_by, consequence_imagined, kind, regret_tilt,",
    "            weight. At least one required.",
    "",
    "Use ONLY after the user has stated a clear judgement on the brake.",
    "The system holds three different stances open without forcing one.",
    "When the user says 'I almost did X' and clearly wishes they had,",
    "lean toward retry — convert it into a now-action while the energy",
    "is fresh. When the user is grateful they didn't, honour the brake",
    "to mark it as wisdom. Never silently default — make the user pick.",
  ].join("\n"),
  schema: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("honour"),
      almost_id: z.string().uuid(),
      status_note: z.string().min(4, "status_note (what made the brake right) is required for honour").max(1500),
    }),
    z.object({
      mode: z.literal("mourn"),
      almost_id: z.string().uuid(),
      status_note: z.string().min(4, "status_note (what you'd want back) is required for mourn").max(1500),
    }),
    z.object({
      mode: z.literal("retry"),
      almost_id: z.string().uuid(),
      status_note: z.string().min(4, "status_note (what you're committing to NOW) is required for retry").max(1500),
      retry_intention_id: z.string().uuid().optional(),
    }),
    z.object({
      mode: z.literal("dismiss"),
      almost_id: z.string().uuid(),
      status_note: z.string().max(1500).optional(),
    }),
    z.object({
      mode: z.literal("unresolve"),
      almost_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("pin"),
      almost_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("unpin"),
      almost_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("archive"),
      almost_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("restore"),
      almost_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("edit"),
      almost_id: z.string().uuid(),
      act_text: z.string().min(4).max(220).optional(),
      pulled_back_by: z.string().min(4).max(220).optional(),
      consequence_imagined: z.string().max(300).optional(),
      kind: z.enum(["reaching_out", "saying_no", "leaving", "staying", "starting", "quitting", "spending", "refusing", "confronting", "asking", "confessing", "other"]).optional(),
      regret_tilt: z.enum(["relief", "regret", "mixed"]).optional(),
      weight: z.number().int().min(1).max(5).optional(),
    }),
  ]),
  inputSchema: {
    type: "object",
    required: ["mode", "almost_id"],
    properties: {
      mode: { type: "string", enum: ["honour", "mourn", "retry", "dismiss", "unresolve", "pin", "unpin", "archive", "restore", "edit"] },
      almost_id: { type: "string" },
      status_note: { type: "string", description: "REQUIRED for honour (what made the brake right), mourn (what you'd want back), and retry (what you're committing to NOW); optional for dismiss." },
      retry_intention_id: { type: "string", description: "Optional UUID of a downstream intention/task created when retrying." },
      act_text: { type: "string" },
      pulled_back_by: { type: "string" },
      consequence_imagined: { type: "string" },
      kind: { type: "string", enum: ["reaching_out", "saying_no", "leaving", "staying", "starting", "quitting", "spending", "refusing", "confronting", "asking", "confessing", "other"] },
      regret_tilt: { type: "string", enum: ["relief", "regret", "mixed"] },
      weight: { type: "number" },
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
    if (input.mode === "honour" || input.mode === "mourn") {
      body.status_note = input.status_note;
    } else if (input.mode === "retry") {
      body.status_note = input.status_note;
      if (input.retry_intention_id) body.retry_intention_id = input.retry_intention_id;
    } else if (input.mode === "dismiss") {
      if (input.status_note) body.status_note = input.status_note;
    } else if (input.mode === "edit") {
      if (input.act_text) body.act_text = input.act_text;
      if (input.pulled_back_by) body.pulled_back_by = input.pulled_back_by;
      if (typeof input.consequence_imagined === "string") body.consequence_imagined = input.consequence_imagined;
      if (input.kind) body.kind = input.kind;
      if (input.regret_tilt) body.regret_tilt = input.regret_tilt;
      if (typeof input.weight === "number") body.weight = input.weight;
    }

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/almosts/${input.almost_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { almost?: Almost };
    const a = j.almost;
    if (!a) return { ok: false, error: "no almost returned" };
    return {
      ok: true,
      almost_id: a.id,
      status: a.status,
      status_note: a.status_note,
      retry_intention_id: a.retry_intention_id,
      pinned: a.pinned,
      archived_at: a.archived_at,
      act_text: a.act_text,
      pulled_back_by: a.pulled_back_by,
      regret_tilt: a.regret_tilt,
      weight: a.weight,
    };
  },
});
