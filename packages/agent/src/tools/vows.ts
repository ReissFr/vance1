// Brain tools for THE VOW LEDGER (§172) — promises-to-self carried forward
// from some past moment. Distinct from §168 shoulds (felt obligations from
// others' voices) and §169 thresholds (identity-crossings made). A vow is
// a self-authored rule. Most are unexamined. Many are obsolete. A few are
// load-bearing identity. The work is to know which.
//
// Two novel diagnostic fields:
//   shadow   — what each vow FORECLOSES. Every "I will always X" implies
//              "I will never not-X". Most values tools surface only the
//              positive commitment. The shadow forces the cost visible.
//   vow_age  — when was this vow first made. Childhood/adolescent vows are
//              often the most load-bearing AND the most likely obsolete —
//              they were authored by a person the user is no longer.
//
// Four novel resolutions, refusing the binary of keep/break:
//   renew   — re-author as still mine. Why it still holds.
//   revise  — spirit holds, letter needs updating. Replacement vow text.
//   release — let it go, name what it protected.
//   honour  — keep but acknowledge cost. The shadow named in the open.
//
// Constitutional review of the self.

import { z } from "zod";
import { defineTool } from "./types";

type Vow = {
  id: string;
  scan_id: string;
  vow_text: string;
  shadow: string;
  origin_event: string | null;
  vow_age: string;
  domain: string;
  weight: number;
  recency: string;
  confidence: number;
  spoken_date: string;
  spoken_message_id: string | null;
  conversation_id: string | null;
  status: string;
  status_note: string | null;
  revised_to: string | null;
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
  renewed: number;
  revised: number;
  released: number;
  honoured: number;
  dismissed: number;
  pinned: number;
  childhood: number;
  adolescent: number;
  early_adult: number;
  adult: number;
  recent: number;
  unknown_age: number;
  high_weight: number;
  organizing_principles: number;
  unexamined_childhood: number;
  unexamined_adolescent: number;
  revised_count: number;
  released_count: number;
  vow_age_counts: Record<string, number>;
  domain_counts: Record<string, number>;
  age_by_domain: Record<string, { childhood: number; adolescent: number; early_adult: number; adult: number; recent: number; unknown: number }>;
  biggest_active: { id: string; spoken_date: string; weight: number } | null;
  oldest_unexamined: { id: string; vow_age: string; weight: number } | null;
  most_recent_released: { id: string; spoken_date: string } | null;
};

export const scanVowsTool = defineTool({
  name: "scan_vows",
  description: [
    "Mine the user's chats for VOWS — promises-to-self carried forward.",
    "Triggers: 'I always', 'I never', 'I promised myself', 'I told myself",
    "I would', 'I swore I would never', 'rule I have for myself', 'I made",
    "a deal with myself', 'I committed to', 'I decided long ago', 'I'm the",
    "kind of person who never/always', 'on principle', 'never again'.",
    "",
    "For each vow captures: verbatim vow_text, shadow (what it forecloses),",
    "optional origin_event (the moment the vow was made, if named),",
    "vow_age, domain, weight 1-5 (1 passing rule -> 5 organizing principle",
    "/ identity-level), recency, confidence.",
    "",
    "Two novel diagnostic fields:",
    "  shadow  — what this vow RULES OUT. Every 'I will always X' implies",
    "            'I will never not-X'. The shadow IS the cost. A vague",
    "            shadow ('it limits me') is useless — the model is",
    "            instructed to make it specific ('I will never let myself",
    "            be financially dependent' shadows 'I will never accept",
    "            help even when it's offered freely').",
    "  vow_age — childhood / adolescent / early_adult / adult / recent /",
    "            unknown. Childhood and adolescent vows are often the most",
    "            load-bearing AND the most likely obsolete — they were",
    "            authored by a person the user is no longer.",
    "",
    "Costs an LLM call (10-25s). Default window 365 days (vows tend to be",
    "older than other patterns); expand to 730 for older mentions. Dedups",
    "by spoken_message_id so rescans never duplicate.",
    "",
    "Use when the user asks 'what have I promised myself', 'what are my",
    "rules', 'what vows am I carrying', 'what do I keep doing on",
    "principle', or as the natural companion to a shoulds (§168) and",
    "thresholds (§169) scan — vows are the third axis of self-authored",
    "constraint, distinct from felt obligation and identity-crossing.",
  ].join("\n"),
  schema: z.object({
    window_days: z.number().int().min(30).max(730).optional().default(365),
  }),
  inputSchema: {
    type: "object",
    properties: {
      window_days: { type: "number", description: "Window in days (30-730, default 365)" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/vows/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ window_days: input.window_days ?? 365 }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `vow scan failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as {
      scan_id?: string;
      inserted?: number;
      latency_ms?: number;
      message?: string;
      vows?: Vow[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      vows: (j.vows ?? []).map((v) => ({
        id: v.id,
        vow_text: v.vow_text,
        shadow: v.shadow,
        origin_event: v.origin_event,
        vow_age: v.vow_age,
        domain: v.domain,
        weight: v.weight,
        recency: v.recency,
        confidence: v.confidence,
        spoken_date: v.spoken_date,
      })),
    };
  },
});

export const listVowsTool = defineTool({
  name: "list_vows",
  description: [
    "List vows in the user's ledger plus stats. Filters:",
    "  status        (active | renewed | revised | released | honoured |",
    "                 dismissed | pinned | archived | all, default active)",
    "  vow_age       (childhood | adolescent | early_adult | adult |",
    "                 recent | unknown | all)",
    "  domain        (work | health | relationships | family | finance |",
    "                 creative | self | spiritual | other | all)",
    "  min_weight    (1-5, default 1)",
    "  min_confidence(1-5, default 2)",
    "  limit         (default 30, max 200)",
    "",
    "Returns vows + stats including organizing_principles (weight=5 —",
    "identity-level vows), unexamined_childhood and unexamined_adolescent",
    "(THE diagnostic categories — vows authored by a person the user is no",
    "longer that have never been reviewed), high_weight, vow_age_counts,",
    "domain_counts, age_by_domain cross-tab, biggest_active,",
    "oldest_unexamined, most_recent_released.",
    "",
    "Use when the user asks 'what vows am I carrying', 'what rules do I",
    "have for myself', 'what childhood promises am I still living by',",
    "'what have I never reviewed', or as ID-evidence retrieval when",
    "surfacing the gap between an old self-authored rule and present life.",
    "",
    "When surfacing, QUOTE the vow_text verbatim AND read the shadow",
    "aloud. The shadow is the diagnostic — surfacing the vow without the",
    "shadow misses the move. Always name the vow_age explicitly so the",
    "user can reckon with how old this rule is.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["active", "renewed", "revised", "released", "honoured", "dismissed", "pinned", "archived", "all"]).optional().default("active"),
    vow_age: z.enum(["childhood", "adolescent", "early_adult", "adult", "recent", "unknown", "all"]).optional().default("all"),
    domain: z.enum(["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other", "all"]).optional().default("all"),
    min_weight: z.number().int().min(1).max(5).optional().default(1),
    min_confidence: z.number().int().min(1).max(5).optional().default(2),
    limit: z.number().int().min(1).max(200).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["active", "renewed", "revised", "released", "honoured", "dismissed", "pinned", "archived", "all"] },
      vow_age: { type: "string", enum: ["childhood", "adolescent", "early_adult", "adult", "recent", "unknown", "all"] },
      domain: { type: "string", enum: ["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other", "all"] },
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
    params.set("vow_age", input.vow_age ?? "all");
    params.set("domain", input.domain ?? "all");
    params.set("min_weight", String(Math.max(1, Math.min(5, input.min_weight ?? 1))));
    params.set("min_confidence", String(Math.max(1, Math.min(5, input.min_confidence ?? 2))));
    params.set("limit", String(Math.max(1, Math.min(200, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/vows?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { vows?: Vow[]; stats?: Stats };
    const rows = j.vows ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      vows: rows.map((v) => ({
        id: v.id,
        vow_text: v.vow_text,
        shadow: v.shadow,
        origin_event: v.origin_event,
        vow_age: v.vow_age,
        domain: v.domain,
        weight: v.weight,
        recency: v.recency,
        confidence: v.confidence,
        status: v.status,
        status_note: v.status_note,
        revised_to: v.revised_to,
        spoken_date: v.spoken_date,
        pinned: v.pinned,
      })),
    };
  },
});

export const respondToVowTool = defineTool({
  name: "respond_to_vow",
  description: [
    "Resolve, edit, or annotate a vow. Specify exactly one mode:",
    "",
    "  renew   — re-author this vow as still mine. status_note IS WHY it",
    "            still holds (REQUIRED — server rejects empty). Use when",
    "            the user has reckoned with the shadow and explicitly",
    "            wants to keep the vow as authored. Examples:",
    "              'I will never let work define me' -> renew with note",
    "              'after the burnout last year I'm clearer than ever",
    "              that this rule is mine.'",
    "",
    "  revise  — the spirit holds but the letter needs updating. Both",
    "            status_note (WHY revising — REQUIRED) AND revised_to (the",
    "            NEW vow text replacing the old — REQUIRED) must be set.",
    "            Use when the user names that the underlying value is",
    "            still theirs but the rule was authored by an earlier",
    "            self. Example:",
    "              'I will never ask anyone for help' -> revise with note",
    "              'the shape was childhood survival; the value was",
    "              autonomy' AND revised_to 'I will choose my dependencies",
    "              consciously rather than accept them by default.'",
    "",
    "  release — let the vow go. status_note IS what this vow PROTECTED",
    "            and why the user no longer needs that protection",
    "            (REQUIRED — server rejects empty). Use when the user has",
    "            named that the rule belongs to a past self. Examples:",
    "              'I will never be poor again' -> release with note 'this",
    "              protected the kid who skipped meals. That kid is safe",
    "              now. The vow runs my financial life from a place of",
    "              fear and I'm choosing to release it.'",
    "",
    "  honour  — keep the vow but explicitly acknowledge the cost.",
    "            status_note IS what the shadow rules out and WHY the user",
    "            keeps it anyway (REQUIRED — server rejects empty). The",
    "            novel stance: refusing the binary of keep-without-cost",
    "            or break-with-loss. Examples:",
    "              'I will always finish what I start' -> honour with note",
    "              'shadow: never quit early even when quitting is right.",
    "              I keep this because completion is core to me, AND I",
    "              accept the cost of occasionally finishing the wrong",
    "              thing.'",
    "",
    "  dismiss   — false alarm / mis-extraction by the model. Optional note.",
    "  unresolve — return to active.",
    "  pin / unpin — toggle pinned (pinned vows surface as shortcuts).",
    "  archive / restore.",
    "  edit      — fix mis-extracted facts. Optional fields: vow_text,",
    "              shadow, origin_event, vow_age, weight. ≥1 required.",
    "",
    "Use ONLY after the user has stated a clear stance. The system holds",
    "five different stances open without forcing one. Never silently",
    "default — make the user pick. The four resolutions (renew/revise/",
    "release/honour) are the constitutional review of the self: every vow",
    "the user keeps unreviewed is a piece of an old self running the",
    "present.",
  ].join("\n"),
  schema: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("renew"),
      vow_id: z.string().uuid(),
      status_note: z.string().min(4, "status_note (re-author the vow as still mine — why it still holds) is required for renew").max(1500),
    }),
    z.object({
      mode: z.literal("revise"),
      vow_id: z.string().uuid(),
      status_note: z.string().min(4, "status_note (why the spirit holds but the letter needs updating) is required for revise").max(1500),
      revised_to: z.string().min(4, "revised_to (the new vow text replacing the old) is required for revise").max(240),
    }),
    z.object({
      mode: z.literal("release"),
      vow_id: z.string().uuid(),
      status_note: z.string().min(4, "status_note (what this vow protected and why you no longer need it) is required for release").max(1500),
    }),
    z.object({
      mode: z.literal("honour"),
      vow_id: z.string().uuid(),
      status_note: z.string().min(4, "status_note (what the cost is — what the shadow rules out — and why you keep it anyway) is required for honour").max(1500),
    }),
    z.object({
      mode: z.literal("dismiss"),
      vow_id: z.string().uuid(),
      status_note: z.string().max(1500).optional(),
    }),
    z.object({
      mode: z.literal("unresolve"),
      vow_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("pin"),
      vow_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("unpin"),
      vow_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("archive"),
      vow_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("restore"),
      vow_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("edit"),
      vow_id: z.string().uuid(),
      vow_text: z.string().min(4).max(240).optional(),
      shadow: z.string().min(4).max(280).optional(),
      origin_event: z.string().max(240).optional(),
      vow_age: z.enum(["childhood", "adolescent", "early_adult", "adult", "recent", "unknown"]).optional(),
      weight: z.number().int().min(1).max(5).optional(),
    }),
  ]),
  inputSchema: {
    type: "object",
    required: ["mode", "vow_id"],
    properties: {
      mode: { type: "string", enum: ["renew", "revise", "release", "honour", "dismiss", "unresolve", "pin", "unpin", "archive", "restore", "edit"] },
      vow_id: { type: "string" },
      status_note: { type: "string", description: "REQUIRED for renew (why still mine), revise (why revising), release (what it protected), and honour (the cost named); optional for dismiss." },
      revised_to: { type: "string", description: "REQUIRED for revise — the new vow text replacing the old." },
      vow_text: { type: "string" },
      shadow: { type: "string" },
      origin_event: { type: "string" },
      vow_age: { type: "string", enum: ["childhood", "adolescent", "early_adult", "adult", "recent", "unknown"] },
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
    if (input.mode === "renew" || input.mode === "release" || input.mode === "honour") {
      body.status_note = input.status_note;
    } else if (input.mode === "revise") {
      body.status_note = input.status_note;
      body.revised_to = input.revised_to;
    } else if (input.mode === "dismiss") {
      if (input.status_note) body.status_note = input.status_note;
    } else if (input.mode === "edit") {
      if (input.vow_text) body.vow_text = input.vow_text;
      if (input.shadow) body.shadow = input.shadow;
      if (typeof input.origin_event === "string") body.origin_event = input.origin_event;
      if (input.vow_age) body.vow_age = input.vow_age;
      if (typeof input.weight === "number") body.weight = input.weight;
    }

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/vows/${input.vow_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { vow?: Vow };
    const v = j.vow;
    if (!v) return { ok: false, error: "no vow returned" };
    return {
      ok: true,
      vow_id: v.id,
      status: v.status,
      status_note: v.status_note,
      revised_to: v.revised_to,
      pinned: v.pinned,
      archived_at: v.archived_at,
      vow_text: v.vow_text,
      shadow: v.shadow,
      vow_age: v.vow_age,
      weight: v.weight,
    };
  },
});
