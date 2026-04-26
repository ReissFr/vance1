// Brain tools for THE FEAR LEDGER (§180) — moments the user articulated
// a feared event or outcome.
//
// Captures "I'm afraid that" / "I worry that" / "what if" / "my biggest
// fear is" / "I'm terrified that" / "I keep having this fear that".
//
// THE NOVEL DIAGNOSTIC is FEAR_REALISATION_RATE — empirically how many
// of the user's articulated fears actually came true. Plus the FEAR_OVERRUN
// _RATE — how much cognitive bandwidth was spent on fears that dissolved
// without happening. Pairs with §179 GUT_ACCURACY_RATE for an empirical
// view of the inner alarm system.

import { z } from "zod";
import { defineTool } from "./types";

type Fear = {
  id: string;
  scan_id: string | null;
  fear_text: string;
  fear_kind: string;
  feared_subject: string | null;
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
  realised: number;
  partially_realised: number;
  dissolved: number;
  displaced: number;
  unresolved: number;
  dismissed: number;
  pinned: number;
  load_bearing_open: number;
  fear_realisation_rate: number;
  fear_overrun_rate: number;
  by_resolution: { realised: number; partially_realised: number; dissolved: number; displaced: number };
  per_kind_rate: Record<string, { realised: number; total: number; rate: number }>;
  per_domain_rate: Record<string, { realised: number; total: number; rate: number }>;
  kind_counts: Record<string, number>;
  open_kind_counts: Record<string, number>;
  most_common_open_kind: null | string;
  most_realised_kind: null | { kind: string; rate: number; total: number };
  least_realised_kind: null | { kind: string; rate: number; total: number };
};

export const scanFearsTool = defineTool({
  name: "scan_fears",
  description: [
    "Mine the user's chat for FEARS — moments where they articulated a",
    "feared event or outcome with a specific feared CLAIM about the future.",
    "",
    "Captures 'I'm afraid that' / 'I worry that' / 'what if' / 'my biggest",
    "fear is' / 'I'm terrified that' / 'I keep having this fear'.",
    "",
    "For each captures: fear_text (the feared event distilled as a future",
    "claim), fear_kind (catastrophising / abandonment / rejection / failure",
    "/ loss / shame / inadequacy / loss_of_control / mortality /",
    "future_uncertainty), feared_subject (what the fear is about), domain,",
    "charge 1-5, recency, confidence, msg_id.",
    "",
    "Costs an LLM call (15-30s). Default window 180 days. Min 14 days.",
    "Won't insert duplicates already in the ledger (UPSERT-by",
    "msg_id+fear_text).",
    "",
    "Use when the user asks 'what fears am I carrying', 'what have I been",
    "afraid of lately', 'how often do my fears come true', 'show me what",
    "I've been worrying about'. The novel diagnostic is FEAR_REALISATION",
    "_RATE — empirical measurement of how many fears actually realised.",
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

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/fears/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ window_days: input.window_days ?? 180 }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `fears scan failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as {
      scan_id?: string;
      inserted?: number;
      latency_ms?: number;
      message?: string;
      fears?: Fear[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      fears: (j.fears ?? []).map((f) => ({
        id: f.id,
        fear_text: f.fear_text,
        fear_kind: f.fear_kind,
        feared_subject: f.feared_subject,
        domain: f.domain,
        charge: f.charge,
        confidence: f.confidence,
        spoken_date: f.spoken_date,
      })),
    };
  },
});

export const listFearsTool = defineTool({
  name: "list_fears",
  description: [
    "List entries in the user's fear ledger plus stats. Filters:",
    "  status     (open | realised | partially_realised | dissolved |",
    "              displaced | unresolved | dismissed | pinned | archived",
    "              | all, default open)",
    "  fear_kind  (catastrophising | abandonment | rejection | failure |",
    "              loss | shame | inadequacy | loss_of_control | mortality",
    "              | future_uncertainty | all)",
    "  domain     (relationships | work | money | health | decision |",
    "              opportunity | safety | self | unknown | all)",
    "  min_charge (1-5, default 1)",
    "  pinned     (true to filter pinned only)",
    "  limit      (default 30, max 200)",
    "",
    "Returns rows + stats including FEAR_REALISATION_RATE (empirically how",
    "many fears actually came true, partially_realised counts as 0.5),",
    "FEAR_OVERRUN_RATE (cognitive bandwidth spent on fears that dissolved),",
    "per_kind_rate (which fear flavours are most prophetic),",
    "most_realised_kind / least_realised_kind.",
    "",
    "Use when the user asks 'how often do my fears come true', 'what fears",
    "am I carrying', 'is this fear worth listening to', 'should I trust",
    "this worry'. ALWAYS report the EMPIRICAL fear_realisation_rate not",
    "a general impression — that's the diagnostic value.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["open", "realised", "partially_realised", "dissolved", "displaced", "unresolved", "dismissed", "pinned", "archived", "all"]).optional().default("open"),
    fear_kind: z.enum(["catastrophising", "abandonment", "rejection", "failure", "loss", "shame", "inadequacy", "loss_of_control", "mortality", "future_uncertainty", "all"]).optional().default("all"),
    domain: z.enum(["relationships", "work", "money", "health", "decision", "opportunity", "safety", "self", "unknown", "all"]).optional().default("all"),
    min_charge: z.number().int().min(1).max(5).optional().default(1),
    pinned: z.boolean().optional().default(false),
    limit: z.number().int().min(1).max(200).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "realised", "partially_realised", "dissolved", "displaced", "unresolved", "dismissed", "pinned", "archived", "all"] },
      fear_kind: { type: "string", enum: ["catastrophising", "abandonment", "rejection", "failure", "loss", "shame", "inadequacy", "loss_of_control", "mortality", "future_uncertainty", "all"] },
      domain: { type: "string", enum: ["relationships", "work", "money", "health", "decision", "opportunity", "safety", "self", "unknown", "all"] },
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
    if (input.fear_kind && input.fear_kind !== "all") params.set("fear_kind", input.fear_kind);
    if (input.domain && input.domain !== "all") params.set("domain", input.domain);
    if (input.min_charge && input.min_charge > 1) params.set("min_charge", String(input.min_charge));
    if (input.pinned) params.set("pinned", "true");
    params.set("limit", String(Math.max(1, Math.min(200, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/fears?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { fears?: Fear[]; stats?: Stats };
    const rows = j.fears ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      fears: rows.map((f) => ({
        id: f.id,
        fear_text: f.fear_text,
        fear_kind: f.fear_kind,
        feared_subject: f.feared_subject,
        domain: f.domain,
        charge: f.charge,
        confidence: f.confidence,
        spoken_date: f.spoken_date,
        status: f.status,
        resolution_note: f.resolution_note,
        pinned: f.pinned,
      })),
    };
  },
});

export const respondToFearTool = defineTool({
  name: "respond_to_fear",
  description: [
    "Resolve, edit, or annotate an entry in the fear ledger. Specify",
    "exactly one mode. The four resolved-with-outcome statuses are:",
    "",
    "  realised           — the feared event happened. resolution_note IS",
    "                       what actually unfolded (REQUIRED).",
    "  partially_realised — some of the feared event happened, not all.",
    "                       resolution_note IS what came true and what",
    "                       didn't (REQUIRED).",
    "  dissolved          — the feared event did not happen and the fear",
    "                       is gone. resolution_note IS what actually",
    "                       unfolded (REQUIRED — be honest, this is the",
    "                       overrun-rate calibration data).",
    "  displaced          — feared event didn't happen but the fear has",
    "                       been replaced by another. resolution_note IS",
    "                       the name of the replacement (REQUIRED — the",
    "                       underlying pattern is still present).",
    "",
    "  unresolved — outcome still unfolding. flag without closing.",
    "  dismiss    — false positive scan (not actually an articulated fear).",
    "  unresolve  — return to open.",
    "  pin / unpin — toggle pinned.",
    "  archive / restore — soft hide / un-hide.",
    "  edit       — fix mis-extracted fear_text / fear_kind / feared_subject",
    "               / domain / charge. ≥1 required.",
    "",
    "Use ONLY after the user has stated the outcome. NEVER silently default.",
    "The novel value of this ledger is empirical — the user finds out their",
    "fear realisation rate from the ACCUMULATED resolutions, so each",
    "resolution is calibration data. Be honest with dissolved especially —",
    "those are the data points that show how often fears overrun.",
  ].join("\n"),
  schema: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("realised"),
      fear_id: z.string().uuid(),
      resolution_note: z.string().min(4, "resolution_note (what actually happened that the fear was right about) is required for realised").max(1500),
    }),
    z.object({
      mode: z.literal("partially_realised"),
      fear_id: z.string().uuid(),
      resolution_note: z.string().min(4, "resolution_note (what part of the fear came true and what didn't) is required for partially_realised").max(1500),
    }),
    z.object({
      mode: z.literal("dissolved"),
      fear_id: z.string().uuid(),
      resolution_note: z.string().min(4, "resolution_note (the fear didn't happen — what actually unfolded) is required for dissolved").max(1500),
    }),
    z.object({
      mode: z.literal("displaced"),
      fear_id: z.string().uuid(),
      resolution_note: z.string().min(4, "resolution_note (this fear didn't realise but a different one took its place — name the replacement) is required for displaced").max(1500),
    }),
    z.object({
      mode: z.literal("unresolved"),
      fear_id: z.string().uuid(),
      resolution_note: z.string().max(1500).optional(),
    }),
    z.object({
      mode: z.literal("dismiss"),
      fear_id: z.string().uuid(),
      resolution_note: z.string().max(1500).optional(),
    }),
    z.object({
      mode: z.literal("unresolve"),
      fear_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("pin"),
      fear_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("unpin"),
      fear_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("archive"),
      fear_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("restore"),
      fear_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("edit"),
      fear_id: z.string().uuid(),
      fear_text: z.string().min(4).max(280).optional(),
      fear_kind: z.enum(["catastrophising", "abandonment", "rejection", "failure", "loss", "shame", "inadequacy", "loss_of_control", "mortality", "future_uncertainty"]).optional(),
      feared_subject: z.string().max(160).optional(),
      domain: z.enum(["relationships", "work", "money", "health", "decision", "opportunity", "safety", "self", "unknown"]).optional(),
      charge: z.number().int().min(1).max(5).optional(),
    }),
  ]),
  inputSchema: {
    type: "object",
    required: ["mode", "fear_id"],
    properties: {
      mode: { type: "string", enum: ["realised", "partially_realised", "dissolved", "displaced", "unresolved", "dismiss", "unresolve", "pin", "unpin", "archive", "restore", "edit"] },
      fear_id: { type: "string" },
      resolution_note: { type: "string", description: "REQUIRED for realised / partially_realised / dissolved / displaced; optional for unresolved / dismiss." },
      fear_text: { type: "string", description: "Optional for edit (4-280 chars)." },
      fear_kind: { type: "string", enum: ["catastrophising", "abandonment", "rejection", "failure", "loss", "shame", "inadequacy", "loss_of_control", "mortality", "future_uncertainty"], description: "Optional for edit." },
      feared_subject: { type: "string", description: "Optional for edit (≤160 chars; pass empty to clear)." },
      domain: { type: "string", enum: ["relationships", "work", "money", "health", "decision", "opportunity", "safety", "self", "unknown"], description: "Optional for edit." },
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
      input.mode === "realised" ||
      input.mode === "partially_realised" ||
      input.mode === "dissolved" ||
      input.mode === "displaced"
    ) {
      body.resolution_note = input.resolution_note;
    } else if (input.mode === "unresolved" || input.mode === "dismiss") {
      if (input.resolution_note) body.resolution_note = input.resolution_note;
    } else if (input.mode === "edit") {
      if (input.fear_text) body.fear_text = input.fear_text;
      if (input.fear_kind) body.fear_kind = input.fear_kind;
      if (input.feared_subject !== undefined) body.feared_subject = input.feared_subject;
      if (input.domain) body.domain = input.domain;
      if (typeof input.charge === "number") body.charge = input.charge;
    }

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/fears/${input.fear_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { fear?: Fear };
    const f = j.fear;
    if (!f) return { ok: false, error: "no fear row returned" };
    return {
      ok: true,
      fear_id: f.id,
      status: f.status,
      resolution_note: f.resolution_note,
      pinned: f.pinned,
      archived_at: f.archived_at,
      fear_text: f.fear_text,
      fear_kind: f.fear_kind,
      feared_subject: f.feared_subject,
    };
  },
});
