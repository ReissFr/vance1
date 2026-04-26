// Brain tools for THE GUT-CHECK LEDGER (§179) — moments the user voiced
// a gut feeling without articulated reasoning. Pattern recognition
// operating below conscious analysis.
//
// Captures the casual "something feels off about" / "my gut says" /
// "I just know" / "bad feeling about" / "can't put my finger on it but".
//
// THE NOVEL DIAGNOSTIC is GUT_ACCURACY_RATE — empirically how often the
// user's gut turns out to be right, regardless of whether they followed
// it. Plus the QUADRANT distribution (followed gut x gut was right) which
// surfaces the user's intuition calibration. Most people either over-trust
// or under-trust intuition without ever measuring.

import { z } from "zod";
import { defineTool } from "./types";

type GutCheck = {
  id: string;
  scan_id: string | null;
  gut_text: string;
  signal_kind: string;
  subject_text: string | null;
  domain: string;
  charge: number;
  recency: string;
  spoken_date: string;
  spoken_message_id: string;
  conversation_id: string | null;
  confidence: number;
  status: string;
  resolution_note: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type Stats = {
  total: number;
  open: number;
  verified_right: number;
  verified_wrong: number;
  ignored_regret: number;
  ignored_relief: number;
  unresolved: number;
  dismissed: number;
  pinned: number;
  load_bearing_open: number;
  gut_accuracy_rate: number;
  gut_trust_rate: number;
  quadrant: {
    verified_right: number;
    verified_wrong: number;
    ignored_regret: number;
    ignored_relief: number;
  };
  per_signal_rate: Record<string, { right: number; total: number; rate: number }>;
  per_domain_rate: Record<string, { right: number; total: number; rate: number }>;
  signal_counts: Record<string, number>;
  open_signal_counts: Record<string, number>;
  most_common_open_signal: null | string;
  most_reliable_signal: null | { signal: string; rate: number; total: number };
  least_reliable_signal: null | { signal: string; rate: number; total: number };
};

export const scanGutChecksTool = defineTool({
  name: "scan_gut_checks",
  description: [
    "Mine the user's chat for GUT CHECKS — moments where they voiced a felt",
    "signal about something WITHOUT articulating a clean reason. Pattern",
    "recognition operating below conscious analysis.",
    "",
    "Captures 'something feels off about' / 'my gut says' / 'I just know'",
    "/ 'I have a bad feeling about' / 'can't put my finger on it but'.",
    "",
    "For each captures: gut_text (the felt signal as a claim about the",
    "world), signal_kind (warning / pull / suspicion / trust / unease /",
    "certainty / dread / nudge / hunch), subject_text (what the gut is",
    "about), domain, charge 1-5, recency, confidence, msg_id.",
    "",
    "Costs an LLM call (15-30s). Default window 180 days. Min 14 days.",
    "Won't insert duplicates already in the ledger (UPSERT-by",
    "msg_id+gut_text).",
    "",
    "Use when the user asks 'is my gut reliable', 'what was my gut telling",
    "me last year', 'how often am I right when I say something feels off',",
    "'should I trust my intuition'. The novel diagnostic is GUT_ACCURACY",
    "_RATE — empirical measurement of how often the user's gut turns out",
    "right, regardless of whether they followed it.",
  ].join("\n"),
  schema: z.object({
    window_days: z.number().int().min(14).max(540).optional().default(180),
  }),
  inputSchema: {
    type: "object",
    properties: {
      window_days: { type: "number", description: "Window in days (14-540, default 180)" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/gut-checks/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ window_days: input.window_days ?? 180 }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `gut-checks scan failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as {
      scan_id?: string;
      inserted?: number;
      latency_ms?: number;
      message?: string;
      gut_checks?: GutCheck[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      gut_checks: (j.gut_checks ?? []).map((g) => ({
        id: g.id,
        gut_text: g.gut_text,
        signal_kind: g.signal_kind,
        subject_text: g.subject_text,
        domain: g.domain,
        charge: g.charge,
        confidence: g.confidence,
        spoken_date: g.spoken_date,
      })),
    };
  },
});

export const listGutChecksTool = defineTool({
  name: "list_gut_checks",
  description: [
    "List entries in the user's gut-check ledger plus stats. Filters:",
    "  status      (open | verified_right | verified_wrong | ignored_regret",
    "               | ignored_relief | unresolved | dismissed | pinned |",
    "               archived | all, default open)",
    "  signal_kind (warning | pull | suspicion | trust | unease | certainty",
    "               | dread | nudge | hunch | all)",
    "  domain      (relationships | work | money | health | decision |",
    "               opportunity | risk | self | unknown | all)",
    "  min_charge  (1-5, default 1)",
    "  pinned      (true to filter pinned only)",
    "  limit       (default 30, max 200)",
    "",
    "Returns rows + stats including the QUADRANT distribution (verified_right",
    "/ verified_wrong / ignored_regret / ignored_relief), gut_accuracy_rate",
    "(empirically how often the gut was right regardless of followthrough)",
    "and gut_trust_rate (how often the user got the right outcome from their",
    "followthrough decision). Plus per_signal_rate (which signal flavours",
    "are most accurate) and most_reliable_signal / least_reliable_signal.",
    "",
    "Use when the user asks 'is my gut reliable', 'how accurate has my",
    "intuition been', 'should I trust my hunches', 'which kinds of gut",
    "signals do I get right'. ALWAYS report the QUADRANT — the diagnostic",
    "value is in seeing where the user's resolved gut signals cluster.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["open", "verified_right", "verified_wrong", "ignored_regret", "ignored_relief", "unresolved", "dismissed", "pinned", "archived", "all"]).optional().default("open"),
    signal_kind: z.enum(["warning", "pull", "suspicion", "trust", "unease", "certainty", "dread", "nudge", "hunch", "all"]).optional().default("all"),
    domain: z.enum(["relationships", "work", "money", "health", "decision", "opportunity", "risk", "self", "unknown", "all"]).optional().default("all"),
    min_charge: z.number().int().min(1).max(5).optional().default(1),
    pinned: z.boolean().optional().default(false),
    limit: z.number().int().min(1).max(200).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "verified_right", "verified_wrong", "ignored_regret", "ignored_relief", "unresolved", "dismissed", "pinned", "archived", "all"] },
      signal_kind: { type: "string", enum: ["warning", "pull", "suspicion", "trust", "unease", "certainty", "dread", "nudge", "hunch", "all"] },
      domain: { type: "string", enum: ["relationships", "work", "money", "health", "decision", "opportunity", "risk", "self", "unknown", "all"] },
      min_charge: { type: "number" },
      pinned: { type: "boolean" },
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
    const status = input.status ?? "open";
    if (status !== "all") params.set("status", status);
    if (input.signal_kind && input.signal_kind !== "all") params.set("signal_kind", input.signal_kind);
    if (input.domain && input.domain !== "all") params.set("domain", input.domain);
    if (input.min_charge && input.min_charge > 1) params.set("min_charge", String(input.min_charge));
    if (input.pinned) params.set("pinned", "true");
    params.set("limit", String(Math.max(1, Math.min(200, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/gut-checks?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { gut_checks?: GutCheck[]; stats?: Stats };
    const rows = j.gut_checks ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      gut_checks: rows.map((g) => ({
        id: g.id,
        gut_text: g.gut_text,
        signal_kind: g.signal_kind,
        subject_text: g.subject_text,
        domain: g.domain,
        charge: g.charge,
        confidence: g.confidence,
        spoken_date: g.spoken_date,
        status: g.status,
        resolution_note: g.resolution_note,
        pinned: g.pinned,
      })),
    };
  },
});

export const respondToGutCheckTool = defineTool({
  name: "respond_to_gut_check",
  description: [
    "Resolve, edit, or annotate an entry in the gut-check ledger. Specify",
    "exactly one mode. The four resolved-with-outcome statuses map onto",
    "the 2x2 QUADRANT (followed gut x gut was right):",
    "",
    "  verified_right — you followed your gut AND it turned out right.",
    "                   Vindicated. resolution_note IS what happened that",
    "                   proved your gut right (REQUIRED).",
    "  verified_wrong — you followed your gut AND it turned out wrong.",
    "                   Costly. resolution_note IS what happened that showed",
    "                   the gut was off (REQUIRED — be honest, this is the",
    "                   calibration data).",
    "  ignored_regret — you DIDN'T follow your gut and it turned out right.",
    "                   The 'I knew' regret. resolution_note IS what you",
    "                   missed (REQUIRED).",
    "  ignored_relief — you DIDN'T follow your gut and it turned out wrong.",
    "                   Glad you didn't. resolution_note IS why you're glad",
    "                   (REQUIRED).",
    "",
    "  unresolved — outcome still unfolding. flag without closing.",
    "  dismiss    — false positive scan (not actually a gut signal).",
    "  unresolve  — return to open.",
    "  pin / unpin — toggle pinned.",
    "  archive / restore — soft hide / un-hide.",
    "  edit       — fix mis-extracted gut_text / signal_kind / subject_text",
    "               / domain / charge. ≥1 required.",
    "",
    "Use ONLY after the user has stated the outcome. NEVER silently default.",
    "The novel value of this ledger is empirical — the user finds out their",
    "gut accuracy rate from the ACCUMULATED resolutions, so each resolution",
    "is calibration data. Be honest with verified_wrong and ignored_relief —",
    "those are the data points that prevent over-trusting the gut.",
  ].join("\n"),
  schema: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("verified_right"),
      gut_check_id: z.string().uuid(),
      resolution_note: z.string().min(4, "resolution_note (what happened that proved your gut right) is required for verified_right").max(1500),
    }),
    z.object({
      mode: z.literal("verified_wrong"),
      gut_check_id: z.string().uuid(),
      resolution_note: z.string().min(4, "resolution_note (what happened that showed your gut was off) is required for verified_wrong").max(1500),
    }),
    z.object({
      mode: z.literal("ignored_regret"),
      gut_check_id: z.string().uuid(),
      resolution_note: z.string().min(4, "resolution_note (what happened that you wish you'd listened to your gut about) is required for ignored_regret").max(1500),
    }),
    z.object({
      mode: z.literal("ignored_relief"),
      gut_check_id: z.string().uuid(),
      resolution_note: z.string().min(4, "resolution_note (why you're glad you didn't follow your gut) is required for ignored_relief").max(1500),
    }),
    z.object({
      mode: z.literal("unresolved"),
      gut_check_id: z.string().uuid(),
      resolution_note: z.string().max(1500).optional(),
    }),
    z.object({
      mode: z.literal("dismiss"),
      gut_check_id: z.string().uuid(),
      resolution_note: z.string().max(1500).optional(),
    }),
    z.object({
      mode: z.literal("unresolve"),
      gut_check_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("pin"),
      gut_check_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("unpin"),
      gut_check_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("archive"),
      gut_check_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("restore"),
      gut_check_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("edit"),
      gut_check_id: z.string().uuid(),
      gut_text: z.string().min(4).max(280).optional(),
      signal_kind: z.enum(["warning", "pull", "suspicion", "trust", "unease", "certainty", "dread", "nudge", "hunch"]).optional(),
      subject_text: z.string().max(160).optional(),
      domain: z.enum(["relationships", "work", "money", "health", "decision", "opportunity", "risk", "self", "unknown"]).optional(),
      charge: z.number().int().min(1).max(5).optional(),
    }),
  ]),
  inputSchema: {
    type: "object",
    required: ["mode", "gut_check_id"],
    properties: {
      mode: { type: "string", enum: ["verified_right", "verified_wrong", "ignored_regret", "ignored_relief", "unresolved", "dismiss", "unresolve", "pin", "unpin", "archive", "restore", "edit"] },
      gut_check_id: { type: "string" },
      resolution_note: { type: "string", description: "REQUIRED for verified_right / verified_wrong / ignored_regret / ignored_relief; optional for unresolved / dismiss." },
      gut_text: { type: "string", description: "Optional for edit (4-280 chars)." },
      signal_kind: { type: "string", enum: ["warning", "pull", "suspicion", "trust", "unease", "certainty", "dread", "nudge", "hunch"], description: "Optional for edit." },
      subject_text: { type: "string", description: "Optional for edit (≤160 chars; pass empty to clear)." },
      domain: { type: "string", enum: ["relationships", "work", "money", "health", "decision", "opportunity", "risk", "self", "unknown"], description: "Optional for edit." },
      charge: { type: "number", description: "Optional for edit (1-5)." },
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
    if (
      input.mode === "verified_right" ||
      input.mode === "verified_wrong" ||
      input.mode === "ignored_regret" ||
      input.mode === "ignored_relief"
    ) {
      body.resolution_note = input.resolution_note;
    } else if (input.mode === "unresolved" || input.mode === "dismiss") {
      if (input.resolution_note) body.resolution_note = input.resolution_note;
    } else if (input.mode === "edit") {
      if (input.gut_text) body.gut_text = input.gut_text;
      if (input.signal_kind) body.signal_kind = input.signal_kind;
      if (input.subject_text !== undefined) body.subject_text = input.subject_text;
      if (input.domain) body.domain = input.domain;
      if (typeof input.charge === "number") body.charge = input.charge;
    }

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/gut-checks/${input.gut_check_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { gut_check?: GutCheck };
    const g = j.gut_check;
    if (!g) return { ok: false, error: "no gut_check row returned" };
    return {
      ok: true,
      gut_check_id: g.id,
      status: g.status,
      resolution_note: g.resolution_note,
      pinned: g.pinned,
      archived_at: g.archived_at,
      gut_text: g.gut_text,
      signal_kind: g.signal_kind,
      subject_text: g.subject_text,
    };
  },
});
