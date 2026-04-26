// Brain tools for THE USED-TO REGISTER — every "I used to ___" the
// user has typed about themselves. Nine kinds: hobby / habit /
// capability / relationship / place / identity / belief / role /
// ritual. Each row records the verbatim phrase, the lost-thing
// distilled (what_was + what_was_kind), longing_score 1-5, and
// pattern_severity which captures recurrence + chronic mourning as
// a single score. Reclaim mechanic: user names ONE concrete action
// (or scheduled action) to bring the lost self back.

import { z } from "zod";
import { defineTool } from "./types";

type RecurrenceSample = { date: string; snippet: string };

type UsedTo = {
  id: string;
  scan_id: string;
  used_to_text: string;
  used_to_kind: string;
  what_was: string | null;
  what_was_kind: string | null;
  longing_score: number;
  domain: string;
  spoken_date: string;
  message_id: string | null;
  conversation_id: string | null;
  recurrence_count: number;
  recurrence_days: number;
  recurrence_with_longing: number;
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

type KindRanked = { kind: string; rows: number; chronic_rows: number; total_recurrence: number; avg_longing: number };
type TargetCount = { target: string; rows: number; chronic_rows: number; total_recurrence: number; avg_longing: number };

type Stats = {
  total: number;
  pending: number;
  reclaimed: number;
  grieved: number;
  let_go: number;
  noted: number;
  dismissed: number;
  chronic_mourning: number;
  high_longing: number;
  lost_hobbies: number;
  lost_relationships: number;
  lost_identities: number;
  kind_counts: Record<string, number>;
  kind_counts_ranked: KindRanked[];
  target_counts: TargetCount[];
  domain_counts: Record<string, number>;
};

export const scanUsedToTool = defineTool({
  name: "scan_used_to",
  description: [
    "Run a USED-TO REGISTER SCAN — mine the user's own messages for",
    "every 'I used to ___' they have typed about themselves. Across",
    "time these stack into a structural inventory of LOST SELVES:",
    "  hobby        — 'i used to draw', 'i used to play guitar'",
    "  habit        — 'i used to wake up at 6', 'i used to journal'",
    "  capability   — 'i used to be able to focus for 3 hours',",
    "                 'i used to be sharper'",
    "  relationship — 'i used to talk to her every day',",
    "                 'we used to hang out'",
    "  place        — 'i used to live in london',",
    "                 'i used to go to that cafe'",
    "  identity     — 'i used to be a writer',",
    "                 'i used to think of myself as someone who shipped fast'",
    "  belief       — 'i used to believe everyone could be trusted'",
    "  role         — 'i used to manage 20 people',",
    "                 'i used to host the dinner'",
    "  ritual       — 'every sunday i used to call mum'",
    "",
    "For each the server records the used_to_text VERBATIM, the",
    "distilled lost-thing (what_was + what_was_kind: activity /",
    "practice / trait / person_or_bond / location / self_concept /",
    "assumption / responsibility / rhythm), and longing_score 1-5",
    "reading the EMOTIONAL DELIVERY (1=neutral biographical fact,",
    "2=mild reminisce, 3=mild longing, 4=clear longing, 5=mourning).",
    "The longing_score is the load-bearing diagnostic — surfacing",
    "an isolated 'i used to draw' next to a chronic 'i used to draw'",
    "with longing 4 across 11 messages tells two completely different",
    "stories about the user's relationship to the same lost thing.",
    "",
    "Phase 2 walks subsequent messages for the same used-to shape,",
    "counting recurrence_count + recurrence_days + recurrence_with_",
    "longing (count of recurrences that ALSO contained a longing word",
    "— miss / wish / those days / I should / back when). pattern_severity:",
    "  5 = recurrence >=10 + recurrence_with_longing >=4 — chronic mourning",
    "  4 = recurrence >=6 + recurrence_with_longing >=2 — entrenched longing",
    "  3 = recurrence >=3 + kind in (hobby, relationship, identity)",
    "  2 = recurrence >=3 mixed",
    "  1 = isolated past-self reference",
    "",
    "Use when the user types 'i used to ___' or 'we used to ___' or",
    "'when i lived in ___' or 'i was the kind of person who ___'.",
    "Different from phantom limbs (resolved decisions) and pivots",
    "(direction changes) — this catches LOST SELVES surfaced as",
    "past-tense identity references.",
    "",
    "Optional: window_days (30-365, default 120). Costs an LLM call",
    "plus a substring scan (10-25s).",
    "",
    "The brain should run this when the user mentions a past habit/",
    "hobby/identity with any emotional weight. Surfacing 'you've",
    "mentioned drawing 11 times in 90 days, 4 of those with longing'",
    "is the structural finding nobody else surfaces.",
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

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/used-to/scan`, {
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
      used_tos?: UsedTo[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      used_tos: (j.used_tos ?? []).map((u) => ({
        id: u.id,
        used_to_kind: u.used_to_kind,
        what_was_kind: u.what_was_kind,
        longing_score: u.longing_score,
        domain: u.domain,
        spoken_date: u.spoken_date,
        recurrence_count: u.recurrence_count,
        recurrence_days: u.recurrence_days,
        recurrence_with_longing: u.recurrence_with_longing,
        pattern_severity: u.pattern_severity,
        confidence: u.confidence,
      })),
    };
  },
});

export const listUsedToTool = defineTool({
  name: "list_used_to",
  description: [
    "List mined used-to statements plus stats. Optional filters:",
    "  status   (pending | reclaimed | grieved | let_go | noted |",
    "            dismissed | pinned | archived | all, default pending)",
    "  kind     (hobby | habit | capability | relationship | place |",
    "            identity | belief | role | ritual | all, default all)",
    "  target   (activity | practice | trait | person_or_bond |",
    "            location | self_concept | assumption | responsibility |",
    "            rhythm | all, default all)",
    "  domain   (work | relationships | health | identity | finance |",
    "            creative | learning | daily | other | all, default all)",
    "  min_severity   (1-5, default 1)",
    "  min_longing    (1-5, default 1) — gate by emotional weight",
    "  min_confidence (1-5, default 2)",
    "  limit          (default 30, max 100)",
    "",
    "Returns rows + stats including chronic_mourning (severity>=4),",
    "high_longing (longing_score>=4), lost_hobbies, lost_relationships,",
    "lost_identities, per-kind counts, kind_counts_ranked (sorted by",
    "total_recurrence with avg_longing — WHICH KINDS of past-self the",
    "user keeps returning to), AND target_counts (activity / practice /",
    "trait / person / location with avg_longing).",
    "",
    "The kind_counts_ranked + target_counts are the load-bearing",
    "diagnostic. 'You mention lost hobbies 14 times across 8 days,",
    "average longing 3.7' is the structural finding. Quote the",
    "verbatim used_to_text AND the distilled what_was when surfacing",
    "rows. Don't paraphrase the lost self.",
    "",
    "Use cases:",
    "  - 'what have I lost most' -> stats.kind_counts_ranked.",
    "  - 'who do I miss' -> filter kind=relationship.",
    "  - 'what hobbies did I drop' -> filter kind=hobby.",
    "  - 'what identity did I shed' -> filter kind=identity.",
    "  - 'what am I mourning chronically' -> filter min_longing=4 +",
    "    min_severity=4.",
    "  - 'what have I brought back' -> filter status=reclaimed.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["pending", "reclaimed", "grieved", "let_go", "noted", "dismissed", "pinned", "archived", "all"]).optional().default("pending"),
    kind: z.enum(["hobby", "habit", "capability", "relationship", "place", "identity", "belief", "role", "ritual", "all"]).optional().default("all"),
    target: z.enum(["activity", "practice", "trait", "person_or_bond", "location", "self_concept", "assumption", "responsibility", "rhythm", "all"]).optional().default("all"),
    domain: z.enum(["work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other", "all"]).optional().default("all"),
    min_severity: z.number().int().min(1).max(5).optional().default(1),
    min_longing: z.number().int().min(1).max(5).optional().default(1),
    min_confidence: z.number().int().min(1).max(5).optional().default(2),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "reclaimed", "grieved", "let_go", "noted", "dismissed", "pinned", "archived", "all"] },
      kind: { type: "string", enum: ["hobby", "habit", "capability", "relationship", "place", "identity", "belief", "role", "ritual", "all"] },
      target: { type: "string", enum: ["activity", "practice", "trait", "person_or_bond", "location", "self_concept", "assumption", "responsibility", "rhythm", "all"] },
      domain: { type: "string", enum: ["work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other", "all"] },
      min_severity: { type: "number" },
      min_longing: { type: "number" },
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
    params.set("min_longing", String(Math.max(1, Math.min(5, input.min_longing ?? 1))));
    params.set("min_confidence", String(Math.max(1, Math.min(5, input.min_confidence ?? 2))));
    params.set("limit", String(Math.max(1, Math.min(100, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/used-to?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { used_tos?: UsedTo[]; stats?: Stats };
    const rows = j.used_tos ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      used_tos: rows.map((u) => ({
        id: u.id,
        used_to_text: u.used_to_text,
        used_to_kind: u.used_to_kind,
        what_was: u.what_was,
        what_was_kind: u.what_was_kind,
        longing_score: u.longing_score,
        domain: u.domain,
        spoken_date: u.spoken_date,
        recurrence_count: u.recurrence_count,
        recurrence_days: u.recurrence_days,
        recurrence_with_longing: u.recurrence_with_longing,
        recurrence_samples: (u.recurrence_samples ?? []).slice(0, 3),
        pattern_severity: u.pattern_severity,
        confidence: u.confidence,
        status: u.status,
        status_note: u.status_note,
        pinned: u.pinned,
      })),
    };
  },
});

export const respondToUsedToTool = defineTool({
  name: "respond_to_used_to",
  description: [
    "Resolve or annotate a mined used-to statement. Specify exactly one",
    "mode:",
    "",
    "  reclaim     — user is BRINGING THE LOST SELF BACK (or scheduling",
    "                to). status_note IS the concrete action — what they",
    "                are doing or have scheduled (REQUIRED — server",
    "                rejects empty notes for this mode). Locks the row",
    "                to status='reclaimed'. Examples:",
    "                  'i used to draw' -> reclaim with status_note",
    "                    'scheduled 30 mins drawing tomorrow 7am'",
    "                  'i used to call mum every sunday' -> reclaim",
    "                    with status_note 'calling mum sunday at 11'",
    "                  'i used to journal' -> reclaim with status_note",
    "                    'opened the journal app, wrote 3 lines tonight'",
    "                Must be CONCRETE. Don't accept vague intentions.",
    "  grieved     — user is naming the loss explicitly without bringing",
    "                it back. Optional status_note holds the grief",
    "                sentence ('I miss being someone who could focus for",
    "                three hours straight').",
    "  let_go      — user consciously releases the lost self. Optional",
    "                status_note explains why ('I am no longer the",
    "                drinker I was and I don't want to be').",
    "  noted       — acknowledged, no action.",
    "  dismissed   — false positive.",
    "  pin / unpin       — keep visible.",
    "  archive / restore — hide / unhide.",
    "",
    "Use 'reclaim' when the user offers a concrete action — capture",
    "their words verbatim or render the action precisely. The reclaim",
    "mechanic is the move that turns mourning into return; vague",
    "intentions ('maybe i should pick it up again') are NOT reclaims.",
    "Push for concrete: 'when?', 'how long?', 'what's the first step?'.",
    "",
    "Use 'grieved' when the user wants to name the loss without",
    "returning to it. Grief is itself a resolution. Use 'let_go' when",
    "the lost self is genuinely no longer wanted.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    mode: z.enum(["reclaim", "grieved", "let_go", "noted", "dismissed", "pin", "unpin", "archive", "unarchive"]),
    status_note: z.string().min(1).max(2000).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "mode"],
    properties: {
      id: { type: "string" },
      mode: { type: "string", enum: ["reclaim", "grieved", "let_go", "noted", "dismissed", "pin", "unpin", "archive", "unarchive"] },
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
        return { ok: false, error: "reclaim mode requires status_note (the concrete action — what the user is doing/scheduled to bring this back)" };
      }
      payload.status = "reclaimed";
      payload.status_note = input.status_note;
    } else if (input.mode === "grieved" || input.mode === "let_go" || input.mode === "noted" || input.mode === "dismissed") {
      payload.status = input.mode;
      if (input.status_note) payload.status_note = input.status_note;
    } else if (input.mode === "pin") payload.pin = true;
    else if (input.mode === "unpin") payload.pin = false;
    else if (input.mode === "archive") payload.archive = true;
    else if (input.mode === "unarchive") payload.restore = true;

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/used-to/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { used_to?: UsedTo };
    if (!j.used_to) return { ok: false, error: "no row returned" };
    const u = j.used_to;
    return {
      ok: true,
      used_to: {
        id: u.id,
        used_to_text: u.used_to_text,
        used_to_kind: u.used_to_kind,
        what_was: u.what_was,
        what_was_kind: u.what_was_kind,
        longing_score: u.longing_score,
        status: u.status,
        status_note: u.status_note,
        pinned: u.pinned,
        archived: u.archived_at != null,
      },
    };
  },
});
