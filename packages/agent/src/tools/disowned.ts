// Brain tools for THE DISOWNED REGISTER — moments the user described
// their own experience as if it belonged to someone else. Five kinds:
// distancing_pronoun / external_attribution / abstract_body / generic_universal
// / passive_self. Each row records the disowned phrase verbatim, the I-FORM
// active-voice reading (what_was_disowned + what_was_disowned_kind), the
// inferred internal voice that did the narrating (self_voice — e.g. 'the
// spectator', 'the narrator', 'the patient'), and pattern_severity which
// captures recurrence + chronic-shape as a single score.

import { z } from "zod";
import { defineTool } from "./types";

type RecurrenceSample = { date: string; snippet: string };

type Disowned = {
  id: string;
  scan_id: string;
  disowned_text: string;
  disowned_kind: string;
  what_was_disowned: string | null;
  what_was_disowned_kind: string | null;
  self_voice: string | null;
  domain: string;
  spoken_date: string;
  spoken_message_id: string | null;
  spoken_conversation_id: string | null;
  recurrence_count: number;
  recurrence_days: number;
  recurrence_with_target: number;
  recurrence_samples: RecurrenceSample[];
  pattern_severity: number;
  confidence: number;
  status: string;
  status_note: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

type VoiceCount = { voice: string; rows: number; chronic_rows: number; total_recurrence: number };
type TargetCount = { target: string; rows: number; chronic_rows: number; total_recurrence: number };

type Stats = {
  total: number;
  pending: number;
  reclaimed: number;
  kept: number;
  noted: number;
  dismissed: number;
  reflex_disowned: number;
  external_attribution: number;
  disowned_emotions: number;
  disowned_bodily: number;
  kind_counts: Record<string, number>;
  target_counts: TargetCount[];
  voice_counts: VoiceCount[];
  domain_counts: Record<string, number>;
};

export const scanDisownedTool = defineTool({
  name: "scan_disowned",
  description: [
    "Run a DISOWNED REGISTER SCAN — mine the user's own messages for",
    "moments they described their own experience as if it belonged to",
    "someone else. The grammatical signature of a SPECTATOR voice — a",
    "narrator who watches the user's life from a third-person remove.",
    "Five kinds:",
    "  distancing_pronoun   — 'you know that feeling when',",
    "                         'we all do this', 'people get like that'",
    "  external_attribution — 'the depression hit', 'anxiety took over',",
    "                         'the panic came back', 'stress is doing this'",
    "  abstract_body        — 'the chest tightens' (vs MY chest), 'the",
    "                         throat closes', 'tears came', 'the body just'",
    "  generic_universal    — 'everyone has this', 'it's just life',",
    "                         'that's how it is', 'we all go through this'",
    "  passive_self         — 'the gym wasn't visited', 'the message",
    "                         didn't get sent', 'nothing got done today'",
    "",
    "For each the server records the disowned_text VERBATIM, the I-FORM",
    "active-voice reading (what_was_disowned + what_was_disowned_kind:",
    "emotion / bodily_state / mental_state / relationship_dynamic /",
    "behaviour / need / desire / judgment), and the inferred self_voice",
    "— a 2-5 word internal voice (e.g. 'the spectator', 'the narrator',",
    "'the patient', 'the observer', 'the case study voice'). The voice",
    "naming is the load-bearing diagnostic — surfacing 'the spectator'",
    "as the recurring narrator across 9 disowned emotions is the pattern",
    "no other system names.",
    "",
    "Phase 2 walks subsequent messages for the same disownership shape,",
    "counting recurrence_count + recurrence_days + recurrence_with_target",
    "(how many of those recurrences ALSO carried a real first-person",
    "subject — distinguishing stylistic shorthand from genuine identity-",
    "disowning). pattern_severity:",
    "  5 = recurrence >=12 + recurrence_with_target >=5 — reflex disowning",
    "  4 = recurrence >=8 + recurrence_with_target >=3 — entrenched spectator",
    "  3 = recurrence >=4 + kind in (external_attribution, abstract_body)",
    "  2 = recurrence >=3 mixed",
    "  1 = isolated disownership",
    "",
    "Use when the user describes their feelings/body/behaviour with",
    "agentless or third-person grammar: 'the depression hit', 'the chest",
    "tightens', 'you know how it feels', 'everyone has this', 'the gym",
    "wasn't visited'. Different from self-erasures (canceling thoughts",
    "AFTER they begin) — this catches identity-disowning grammar in",
    "real time.",
    "",
    "Optional: window_days (30-365, default 120). Costs an LLM call",
    "plus a substring scan (10-25s).",
    "",
    "The brain should run this when the user is describing themselves",
    "in third-person or agentless terms. Surfacing 'you've described",
    "your emotions externally 11 times in 90 days, always with the",
    "spectator voice' is the structural finding.",
  ].join("\n"),
  schema: z.object({
    window_days: z.number().int().min(30).max(365).optional(),
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

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/disowned/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(input ?? {}),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `scan failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as {
      scan_id?: string;
      inserted?: number;
      latency_ms?: number;
      message?: string;
      disownerships?: Disowned[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      disownerships: (j.disownerships ?? []).map((c) => ({
        id: c.id,
        disowned_kind: c.disowned_kind,
        what_was_disowned_kind: c.what_was_disowned_kind,
        self_voice: c.self_voice,
        domain: c.domain,
        spoken_date: c.spoken_date,
        recurrence_count: c.recurrence_count,
        recurrence_days: c.recurrence_days,
        recurrence_with_target: c.recurrence_with_target,
        pattern_severity: c.pattern_severity,
        confidence: c.confidence,
      })),
    };
  },
});

export const listDisownedTool = defineTool({
  name: "list_disowned",
  description: [
    "List mined disownerships plus stats. Optional filters:",
    "  status   (pending | reclaimed | kept | noted | dismissed |",
    "            pinned | archived | all, default pending)",
    "  kind     (distancing_pronoun | external_attribution |",
    "            abstract_body | generic_universal | passive_self |",
    "            all, default all)",
    "  target   (emotion | bodily_state | mental_state |",
    "            relationship_dynamic | behaviour | need | desire |",
    "            judgment | all, default all)",
    "  domain   (work | relationships | health | identity | finance |",
    "            creative | learning | daily | other | all, default all)",
    "  min_severity   (1-5, default 1)",
    "  min_confidence (1-5, default 2)",
    "  limit          (default 30, max 100)",
    "",
    "Returns rows + stats including reflex_disowned (severity>=4),",
    "external_attribution count, disowned_emotions, disowned_bodily,",
    "per-kind / per-domain counts, target_counts (sorted by",
    "total_recurrence — WHAT gets disowned most: emotions, bodily states,",
    "behaviours), AND voice_counts — top 10 spectator voices the user",
    "keeps narrating themselves through.",
    "",
    "The voice_counts and target_counts are the load-bearing diagnostic.",
    "'You keep narrating your emotions through the spectator voice — 11",
    "times in 90 days' is the structural finding. Quote the self_voice",
    "AND the verbatim disowned_text when surfacing rows.",
    "",
    "Use cases:",
    "  - 'who narrates my life from outside' -> stats.voice_counts.",
    "  - 'what do I keep externalising' -> stats.target_counts.",
    "  - 'when do I disown my emotions' -> filter target=emotion.",
    "  - 'when do I disown my body' -> filter target=bodily_state.",
    "  - 'when do I describe my feelings as the depression/anxiety hitting'",
    "    -> filter kind=external_attribution.",
    "  - 'what have I reclaimed' -> filter status=reclaimed.",
    "",
    "When surfacing a row, quote disowned_text verbatim AND the",
    "what_was_disowned (I-form rewrite) and self_voice. Don't paraphrase",
    "the disownership.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["pending", "reclaimed", "kept", "noted", "dismissed", "pinned", "archived", "all"]).optional().default("pending"),
    kind: z.enum(["distancing_pronoun", "external_attribution", "abstract_body", "generic_universal", "passive_self", "all"]).optional().default("all"),
    target: z.enum(["emotion", "bodily_state", "mental_state", "relationship_dynamic", "behaviour", "need", "desire", "judgment", "all"]).optional().default("all"),
    domain: z.enum(["work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other", "all"]).optional().default("all"),
    min_severity: z.number().int().min(1).max(5).optional().default(1),
    min_confidence: z.number().int().min(1).max(5).optional().default(2),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "reclaimed", "kept", "noted", "dismissed", "pinned", "archived", "all"] },
      kind: { type: "string", enum: ["distancing_pronoun", "external_attribution", "abstract_body", "generic_universal", "passive_self", "all"] },
      target: { type: "string", enum: ["emotion", "bodily_state", "mental_state", "relationship_dynamic", "behaviour", "need", "desire", "judgment", "all"] },
      domain: { type: "string", enum: ["work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other", "all"] },
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
    params.set("status", input.status ?? "pending");
    params.set("kind", input.kind ?? "all");
    params.set("target", input.target ?? "all");
    params.set("domain", input.domain ?? "all");
    params.set("min_severity", String(Math.max(1, Math.min(5, input.min_severity ?? 1))));
    params.set("min_confidence", String(Math.max(1, Math.min(5, input.min_confidence ?? 2))));
    params.set("limit", String(Math.max(1, Math.min(100, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/disowned?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { disownerships?: Disowned[]; stats?: Stats };
    const rows = j.disownerships ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      disownerships: rows.map((c) => ({
        id: c.id,
        disowned_text: c.disowned_text,
        disowned_kind: c.disowned_kind,
        what_was_disowned: c.what_was_disowned,
        what_was_disowned_kind: c.what_was_disowned_kind,
        self_voice: c.self_voice,
        domain: c.domain,
        spoken_date: c.spoken_date,
        recurrence_count: c.recurrence_count,
        recurrence_days: c.recurrence_days,
        recurrence_with_target: c.recurrence_with_target,
        recurrence_samples: (c.recurrence_samples ?? []).slice(0, 3),
        pattern_severity: c.pattern_severity,
        confidence: c.confidence,
        status: c.status,
        status_note: c.status_note,
        pinned: c.pinned,
      })),
    };
  },
});

export const respondToDisownedTool = defineTool({
  name: "respond_to_disowned",
  description: [
    "Resolve or annotate a mined disownership. Specify exactly one mode:",
    "",
    "  reclaim     — user is RECLAIMING the experience as theirs NOW.",
    "                status_note IS the I-FORM ACTIVE-VOICE rewrite —",
    "                what they're saying about themselves when they own",
    "                it grammatically (REQUIRED — server rejects empty",
    "                notes for this mode). Locks the row to",
    "                status='reclaimed'. Examples:",
    "                  'the depression hit' -> 'I'm depressed'",
    "                  'the chest tightens' -> 'my chest is tight'",
    "                  'you know that feeling when nothing feels real'",
    "                    -> 'I feel like nothing is real right now'",
    "                  'the gym wasn't visited' -> 'I didn't go to the gym'",
    "                Must be in the user's own words — don't fabricate.",
    "  kept        — user explicitly chooses the disowned framing (some",
    "                third-person framings are deliberate distance and",
    "                that's fine). Optional status_note explains why.",
    "  noted       — acknowledged but neither reclaimed nor kept.",
    "                Optional status_note.",
    "  dismissed   — false positive / not actually disownership.",
    "  pin / unpin       — keep visible.",
    "  archive / restore — hide / unhide.",
    "",
    "Use 'reclaim' when the user offers the I-form rewrite — capture",
    "their words verbatim. A good reclamation puts the user as the",
    "subject, in active voice, owning the experience grammatically.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    mode: z.enum(["reclaim", "kept", "noted", "dismissed", "pin", "unpin", "archive", "unarchive"]),
    status_note: z.string().min(1).max(2000).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "mode"],
    properties: {
      id: { type: "string" },
      mode: { type: "string", enum: ["reclaim", "kept", "noted", "dismissed", "pin", "unpin", "archive", "unarchive"] },
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
    if (input.mode === "reclaim") {
      if (!input.status_note || input.status_note.trim().length === 0) {
        return { ok: false, error: "reclaim mode requires status_note (the user's actual I-form rewrite)" };
      }
      payload.status = "reclaimed";
      payload.status_note = input.status_note;
    } else if (["kept", "noted", "dismissed"].includes(input.mode)) {
      payload.status = input.mode;
      if (input.status_note) payload.status_note = input.status_note;
    } else if (input.mode === "pin") payload.pin = true;
    else if (input.mode === "unpin") payload.pin = false;
    else if (input.mode === "archive") payload.archive = true;
    else if (input.mode === "unarchive") payload.restore = true;

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/disowned/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { disowned?: Disowned };
    if (!j.disowned) return { ok: false, error: "no row returned" };
    const c = j.disowned;
    return {
      ok: true,
      disowned: {
        id: c.id,
        disowned_text: c.disowned_text,
        disowned_kind: c.disowned_kind,
        what_was_disowned: c.what_was_disowned,
        what_was_disowned_kind: c.what_was_disowned_kind,
        self_voice: c.self_voice,
        status: c.status,
        status_note: c.status_note,
        pinned: c.pinned,
        archived: c.archived_at != null,
      },
    };
  },
});
