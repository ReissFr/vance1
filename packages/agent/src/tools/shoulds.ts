// Brain tools for THE SHOULD LEDGER (§166) — every "I should ___",
// "I ought to ___", "I need to ___", "I have to ___", "I'm supposed
// to ___" the user has typed about themselves. Eight kinds: moral /
// practical / social / relational / health / identity / work /
// financial. The novel hook: obligation_source (whose voice put this
// should there — self / parent / partner / inner_critic / social_norm
// / professional_norm / financial_judge / abstract_other). Plus a
// release valve (status='released') for shoulds that aren't actually
// the user's to carry.

import { z } from "zod";
import { defineTool } from "./types";

type RecurrenceSample = { date: string; snippet: string };

type Should = {
  id: string;
  scan_id: string;
  should_text: string;
  should_kind: string;
  distilled_obligation: string;
  obligation_source: string;
  charge_score: number;
  domain: string;
  spoken_date: string;
  spoken_message_id: string | null;
  spoken_conversation_id: string | null;
  recurrence_count: number;
  recurrence_days: number;
  recurrence_with_charge: number;
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

type SourceRanked = { source: string; rows: number; chronic_rows: number; total_recurrence: number; avg_charge: number };
type KindRanked = { kind: string; rows: number; chronic_rows: number; total_recurrence: number; avg_charge: number };

type Stats = {
  total: number;
  pending: number;
  done: number;
  released: number;
  converted: number;
  noted: number;
  dismissed: number;
  chronic_should: number;
  high_charge: number;
  inner_critic_count: number;
  parent_count: number;
  self_count: number;
  source_counts_ranked: SourceRanked[];
  kind_counts_ranked: KindRanked[];
  kind_counts: Record<string, number>;
  source_counts: Record<string, number>;
  domain_counts: Record<string, number>;
};

export const scanShouldsTool = defineTool({
  name: "scan_shoulds",
  description: [
    "Run a SHOULD LEDGER SCAN — mine the user's own messages for",
    "every 'I should ___', 'I ought to ___', 'I need to ___',",
    "'I have to ___', 'I'm supposed to ___', 'I gotta ___', or",
    "'I must ___' they have typed about themselves. Across time these",
    "stack into a structural inventory of UNMET OBLIGATIONS. Eight",
    "kinds:",
    "  moral       — 'i should be more patient'",
    "  practical   — 'i should sort that drawer'",
    "  social      — 'i should call her', 'i should text him back'",
    "  relational  — 'i should be more present with my partner'",
    "  health      — 'i should eat better', 'i should stop drinking'",
    "  identity    — 'i should be the kind of person who ships'",
    "  work        — 'i should reply to that client'",
    "  financial   — 'i should save more', 'i should cancel that subscription'",
    "",
    "The NOVEL hook: each row also gets an obligation_source — whose",
    "voice put this should there. self / parent / partner /",
    "inner_critic / social_norm / professional_norm / financial_judge /",
    "abstract_other. Naming the source is what turns the ledger from",
    "a guilt-list into a self-authorship exercise — the user can see",
    "which shoulds are theirs and which were absorbed without",
    "inspection.",
    "",
    "Each row also has charge_score 1-5 (1=casual, 5=guilt-saturated)",
    "reading the EMOTIONAL DELIVERY of the should. Same surface 'i",
    "should call mum' is biographical at charge 1 and self-flagellating",
    "at charge 5.",
    "",
    "Phase 2 walks subsequent messages for the same should shape,",
    "counting recurrence_count + recurrence_days + recurrence_with_",
    "charge (count of recurrences that ALSO contained a guilt word —",
    "guilty / feel bad / keep meaning to / been meaning to / haven't",
    "got round to / keep telling myself). pattern_severity:",
    "  5 = recurrence >=10 + recurrence_with_charge >=4 — chronic should",
    "  4 = recurrence >=6 + recurrence_with_charge >=2 — entrenched ought",
    "  3 = recurrence >=3 + kind in (relational, health, identity)",
    "  2 = recurrence >=3 mixed",
    "  1 = isolated should",
    "",
    "Use when the user types 'i should ___' / 'i ought to ___' / 'i",
    "need to ___' / 'i have to ___' / 'i'm supposed to ___'. Different",
    "from promises (committed actions) and phantom limbs (resolved",
    "decisions that keep coming back) — this catches the unmet",
    "obligations the user feels but has not yet committed to or",
    "released.",
    "",
    "Optional: window_days (30-365, default 120). Costs an LLM call",
    "plus a substring scan (10-25s).",
    "",
    "Run when the user mentions chronic guilt, ongoing oughts, or",
    "asks about 'what am I carrying'. Surfacing 'you have said \"i",
    "should call mum\" 9 times across 60 days, all charge 4-5, voice:",
    "inner critic' is the load-bearing diagnostic.",
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

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/shoulds/scan`, {
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
      shoulds?: Should[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      shoulds: (j.shoulds ?? []).map((s) => ({
        id: s.id,
        should_kind: s.should_kind,
        obligation_source: s.obligation_source,
        charge_score: s.charge_score,
        domain: s.domain,
        spoken_date: s.spoken_date,
        recurrence_count: s.recurrence_count,
        recurrence_days: s.recurrence_days,
        recurrence_with_charge: s.recurrence_with_charge,
        pattern_severity: s.pattern_severity,
        confidence: s.confidence,
      })),
    };
  },
});

export const listShouldsTool = defineTool({
  name: "list_shoulds",
  description: [
    "List mined shoulds plus stats. Optional filters:",
    "  status   (pending | done | released | converted | noted |",
    "            dismissed | pinned | archived | all, default pending)",
    "  kind     (moral | practical | social | relational | health |",
    "            identity | work | financial | all, default all)",
    "  source   (self | parent | partner | inner_critic | social_norm |",
    "            professional_norm | financial_judge | abstract_other |",
    "            all, default all)",
    "  domain   (work | relationships | health | identity | finance |",
    "            creative | learning | daily | other | all, default all)",
    "  min_severity   (1-5, default 1)",
    "  min_charge     (1-5, default 1) — gate by guilt weight",
    "  min_confidence (1-5, default 2)",
    "  limit          (default 30, max 100)",
    "",
    "Returns rows + stats including chronic_should (severity>=4),",
    "high_charge (charge_score>=4), inner_critic_count, parent_count,",
    "self_count, source_counts_ranked (sorted by total_recurrence with",
    "avg_charge — WHOSE VOICE puts most shoulds in the user's head),",
    "AND kind_counts_ranked (which kinds of obligation the user carries",
    "most).",
    "",
    "The source_counts_ranked is the load-bearing diagnostic. 'You",
    "carry 14 shoulds from your inner critic with average charge 4.2'",
    "is more diagnostic than any single should — surface that.",
    "",
    "Use cases:",
    "  - 'what am I carrying' -> stats.kind_counts_ranked + source_counts_ranked.",
    "  - 'whose voice keeps showing up' -> source_counts_ranked.",
    "  - 'what shoulds am I guilt-saturated about' -> min_charge=4.",
    "  - 'what shoulds have I released as not mine' -> status=released.",
    "  - 'what shoulds did I convert into actual actions' -> status=converted.",
    "",
    "Quote the verbatim should_text AND the distilled_obligation when",
    "surfacing rows. ALWAYS name the obligation_source out loud — that",
    "is the diagnostic that distinguishes this from a todo list.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["pending", "done", "released", "converted", "noted", "dismissed", "pinned", "archived", "all"]).optional().default("pending"),
    kind: z.enum(["moral", "practical", "social", "relational", "health", "identity", "work", "financial", "all"]).optional().default("all"),
    source: z.enum(["self", "parent", "partner", "inner_critic", "social_norm", "professional_norm", "financial_judge", "abstract_other", "all"]).optional().default("all"),
    domain: z.enum(["work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other", "all"]).optional().default("all"),
    min_severity: z.number().int().min(1).max(5).optional().default(1),
    min_charge: z.number().int().min(1).max(5).optional().default(1),
    min_confidence: z.number().int().min(1).max(5).optional().default(2),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "done", "released", "converted", "noted", "dismissed", "pinned", "archived", "all"] },
      kind: { type: "string", enum: ["moral", "practical", "social", "relational", "health", "identity", "work", "financial", "all"] },
      source: { type: "string", enum: ["self", "parent", "partner", "inner_critic", "social_norm", "professional_norm", "financial_judge", "abstract_other", "all"] },
      domain: { type: "string", enum: ["work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other", "all"] },
      min_severity: { type: "number" },
      min_charge: { type: "number" },
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
    params.set("source", input.source ?? "all");
    params.set("domain", input.domain ?? "all");
    params.set("min_severity", String(Math.max(1, Math.min(5, input.min_severity ?? 1))));
    params.set("min_charge", String(Math.max(1, Math.min(5, input.min_charge ?? 1))));
    params.set("min_confidence", String(Math.max(1, Math.min(5, input.min_confidence ?? 2))));
    params.set("limit", String(Math.max(1, Math.min(100, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/shoulds?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { shoulds?: Should[]; stats?: Stats };
    const rows = j.shoulds ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      shoulds: rows.map((s) => ({
        id: s.id,
        should_text: s.should_text,
        should_kind: s.should_kind,
        distilled_obligation: s.distilled_obligation,
        obligation_source: s.obligation_source,
        charge_score: s.charge_score,
        domain: s.domain,
        spoken_date: s.spoken_date,
        recurrence_count: s.recurrence_count,
        recurrence_days: s.recurrence_days,
        recurrence_with_charge: s.recurrence_with_charge,
        recurrence_samples: (s.recurrence_samples ?? []).slice(0, 3),
        pattern_severity: s.pattern_severity,
        confidence: s.confidence,
        status: s.status,
        status_note: s.status_note,
        pinned: s.pinned,
      })),
    };
  },
});

export const respondToShouldTool = defineTool({
  name: "respond_to_should",
  description: [
    "Resolve or annotate a mined should. Specify exactly one mode:",
    "",
    "  release     — user is RELEASING this should as not actually theirs",
    "                to carry. status_note IS the reason — whose voice",
    "                this is and why the user doesn't endorse it",
    "                (REQUIRED — server rejects empty notes for this",
    "                mode). Locks the row to status='released'. The",
    "                novel move. Examples:",
    "                  'i should call my mum more' (parent voice) ->",
    "                    release with status_note 'this is my mum's",
    "                    standard, not mine. our relationship is",
    "                    healthy as it is.'",
    "                  'i should be working harder' (professional_norm)",
    "                    -> release with status_note 'this is the",
    "                    hustle culture i was raised on. i'm working",
    "                    plenty.'",
    "  convert     — user is COMMITTING to do it. status_note IS the",
    "                concrete action and when (REQUIRED — server",
    "                rejects empty). Locks the row to status='converted'.",
    "                Examples:",
    "                  'i should call her' -> convert with status_note",
    "                    'calling her sunday at 6pm'.",
    "                  'i should book a gp' -> convert with status_note",
    "                    'booking GP appointment tomorrow morning'.",
    "                Push for CONCRETE. Vague intentions ('maybe i'll",
    "                get round to it') are NOT conversions.",
    "  done        — already handled. Optional status_note describes",
    "                how ('called her on tuesday', 'sorted the drawer",
    "                last weekend').",
    "  noted       — acknowledged, no action.",
    "  dismissed   — false positive.",
    "  pin / unpin       — keep visible.",
    "  archive / restore — hide / unhide.",
    "",
    "The release move is the load-bearing one. Most apps would push",
    "the user to DO the should. This ledger lets the user RELEASE the",
    "should — name whose voice it is and consciously let it go. That's",
    "what makes this a self-authorship exercise rather than a guilt",
    "list. When the obligation_source is parent, social_norm, or",
    "inner_critic — STRONGLY consider that release might be the right",
    "move, not conversion.",
    "",
    "When converting, the brain should PUSH for concrete: 'when?',",
    "'what's the first step?', 'how long?'. 'I'll get to it' is not a",
    "conversion.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    mode: z.enum(["release", "convert", "done", "noted", "dismissed", "pin", "unpin", "archive", "unarchive"]),
    status_note: z.string().min(1).max(2000).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "mode"],
    properties: {
      id: { type: "string" },
      mode: { type: "string", enum: ["release", "convert", "done", "noted", "dismissed", "pin", "unpin", "archive", "unarchive"] },
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
    if (input.mode === "release") {
      if (!input.status_note || input.status_note.trim().length === 0) {
        return { ok: false, error: "release mode requires status_note (whose voice this is and why the user doesn't endorse it)" };
      }
      payload.status = "released";
      payload.status_note = input.status_note;
    } else if (input.mode === "convert") {
      if (!input.status_note || input.status_note.trim().length === 0) {
        return { ok: false, error: "convert mode requires status_note (the concrete action and when)" };
      }
      payload.status = "converted";
      payload.status_note = input.status_note;
    } else if (input.mode === "done" || input.mode === "noted" || input.mode === "dismissed") {
      payload.status = input.mode;
      if (input.status_note) payload.status_note = input.status_note;
    } else if (input.mode === "pin") payload.pin = true;
    else if (input.mode === "unpin") payload.pin = false;
    else if (input.mode === "archive") payload.archive = true;
    else if (input.mode === "unarchive") payload.restore = true;

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/shoulds/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { should?: Should };
    if (!j.should) return { ok: false, error: "no row returned" };
    const s = j.should;
    return {
      ok: true,
      should: {
        id: s.id,
        should_text: s.should_text,
        should_kind: s.should_kind,
        distilled_obligation: s.distilled_obligation,
        obligation_source: s.obligation_source,
        charge_score: s.charge_score,
        status: s.status,
        status_note: s.status_note,
        pinned: s.pinned,
        archived: s.archived_at != null,
      },
    };
  },
});
