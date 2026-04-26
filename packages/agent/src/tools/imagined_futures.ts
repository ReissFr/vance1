// Brain tools for THE IMAGINED-FUTURE REGISTER (§171) — the fourth corner
// of the temporal coordinate system of self-imagination:
//   §165 used-to        — past selves you've LOST
//   §169 thresholds     — present selves you've CROSSED INTO
//   §170 almosts        — present selves you ALMOST crossed into and didn't
//   §171 imagined-futures — future selves you've been VISITING mentally
//
// The novel hook: pull_kind. Same surface phrase ('I keep thinking about
// moving to Lisbon') can be SEEKING (a genuine pull, asking to be made
// real), ESCAPING (a pressure-release valve — the imagining does the work,
// the future is not the actual goal), GRIEVING (mourning a path that has
// already closed), or ENTERTAINING (curiosity without weight). Naming
// which IS the move. Most futures-tracking tools collapse this into
// 'make it a goal' (force pursue) or 'stop daydreaming' (force release).
// The four-way split refuses the binary.
//
// The novel resolution: pursue. Converts an imagined future into a
// PRESENT step. status_note IS the first concrete action. Optional
// pursue_intention_id links to a downstream task/intention.

import { z } from "zod";
import { defineTool } from "./types";

type ImaginedFuture = {
  id: string;
  scan_id: string;
  act_text: string;
  future_state: string;
  pull_kind: string;
  domain: string;
  weight: number;
  recency: string;
  confidence: number;
  spoken_date: string;
  spoken_message_id: string | null;
  conversation_id: string | null;
  status: string;
  status_note: string | null;
  pursue_intention_id: string | null;
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
  pursuing: number;
  released: number;
  sitting_with: number;
  grieved: number;
  dismissed: number;
  pinned: number;
  seeking: number;
  escaping: number;
  grieving: number;
  entertaining: number;
  high_weight: number;
  seeking_active: number;
  escaping_active: number;
  grieving_active: number;
  seeking_pursued: number;
  grieving_grieved: number;
  pull_kind_counts: Record<string, number>;
  domain_counts: Record<string, number>;
  kind_by_domain: Record<string, { seeking: number; escaping: number; grieving: number; entertaining: number }>;
  biggest_seeking: { id: string; spoken_date: string; weight: number } | null;
  biggest_escaping: { id: string; spoken_date: string; weight: number } | null;
  most_recent_grieving: { id: string; spoken_date: string } | null;
  most_recent_seeking: { id: string; spoken_date: string } | null;
};

export const scanImaginedFuturesTool = defineTool({
  name: "scan_imagined_futures",
  description: [
    "Mine the user's chats for IMAGINED FUTURES — futures the user has",
    "been visiting mentally. Triggers: 'I keep thinking about', 'I find",
    "myself wondering', 'I picture myself', 'I daydream about', 'what if",
    "I just', 'in another life', 'the version of me who', 'imagine if I',",
    "'maybe one day I', 'when I'm older', 'I've been fantasising about',",
    "'I dream about', 'I can see myself'.",
    "",
    "For each imagined future captures: verbatim act_text, distilled",
    "future_state (what the life looks like), pull_kind, domain, weight",
    "1-5 (intensity of the imagining), recency, confidence.",
    "",
    "The novel signal is PULL_KIND — the four-way split that refuses",
    "the typical 'make it a goal vs stop daydreaming' binary:",
    "  seeking      — a genuine pull. This future is asking to be made",
    "                 real. The user is leaning toward it.",
    "  escaping     — a pressure-release valve. The imagining itself is",
    "                 doing the work; the future is not the actual goal.",
    "                 Treating it as a goal misreads it.",
    "  grieving     — mourning a path that has already closed. Grief",
    "                 work, not planning work.",
    "  entertaining — curiosity without weight. Idle wondering. Not a pull.",
    "Naming which IS the move.",
    "",
    "Costs an LLM call (10-25s). Default window 180 days; expand to 365",
    "or 730 for older mentions. Dedups by spoken_message_id.",
    "",
    "Use when the user asks 'what futures have I been imagining', 'what",
    "do I keep thinking about', 'what am I daydreaming about', 'what's",
    "calling me', or as the natural fourth-corner companion to a past",
    "(used-to), present-crossed (thresholds), and present-almost (almosts)",
    "scan.",
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

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/imagined-futures/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ window_days: input.window_days ?? 180 }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `imagined-future scan failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as {
      scan_id?: string;
      inserted?: number;
      latency_ms?: number;
      message?: string;
      imagined_futures?: ImaginedFuture[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      imagined_futures: (j.imagined_futures ?? []).map((f) => ({
        id: f.id,
        act_text: f.act_text,
        future_state: f.future_state,
        pull_kind: f.pull_kind,
        domain: f.domain,
        weight: f.weight,
        recency: f.recency,
        confidence: f.confidence,
        spoken_date: f.spoken_date,
      })),
    };
  },
});

export const listImaginedFuturesTool = defineTool({
  name: "list_imagined_futures",
  description: [
    "List imagined futures in the user's register plus stats. Filters:",
    "  status        (active | pursuing | released | sitting_with |",
    "                 grieved | dismissed | pinned | archived | all,",
    "                 default active)",
    "  pull_kind     (seeking | escaping | grieving | entertaining | all)",
    "  domain        (work | health | relationships | family | finance |",
    "                 creative | self | spiritual | other | all)",
    "  min_weight    (1-5, default 1)",
    "  min_confidence(1-5, default 2)",
    "  limit         (default 30, max 200)",
    "",
    "Returns futures + stats including seeking/escaping/grieving/",
    "entertaining counts, high_weight (weight>=4 vivid+), seeking_active",
    "(genuine pulls the user has not yet pursued — the most actionable",
    "category), escaping_active (pressure-release valves — the diagnostic",
    "category; treating these as goals misreads them), grieving_active",
    "(closed paths still aching), seeking_pursued (futures converted into",
    "present steps), kind_by_domain cross-tab, biggest_seeking,",
    "biggest_escaping, most_recent_grieving, most_recent_seeking.",
    "",
    "Use when the user asks 'what futures am I imagining', 'what's",
    "calling me', 'what do I keep daydreaming about', 'where am I",
    "escaping into', 'what am I grieving', or as ID-evidence retrieval",
    "when surfacing the gap between mental visiting and present action.",
    "",
    "When surfacing, QUOTE the act_text verbatim and read the future_state",
    "aloud — the diagnostic value is in the texture of the imagined life,",
    "not the abstract domain. Always name the pull_kind explicitly so the",
    "user can confirm or reframe.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["active", "pursuing", "released", "sitting_with", "grieved", "dismissed", "pinned", "archived", "all"]).optional().default("active"),
    pull_kind: z.enum(["seeking", "escaping", "grieving", "entertaining", "all"]).optional().default("all"),
    domain: z.enum(["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other", "all"]).optional().default("all"),
    min_weight: z.number().int().min(1).max(5).optional().default(1),
    min_confidence: z.number().int().min(1).max(5).optional().default(2),
    limit: z.number().int().min(1).max(200).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["active", "pursuing", "released", "sitting_with", "grieved", "dismissed", "pinned", "archived", "all"] },
      pull_kind: { type: "string", enum: ["seeking", "escaping", "grieving", "entertaining", "all"] },
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
    params.set("pull_kind", input.pull_kind ?? "all");
    params.set("domain", input.domain ?? "all");
    params.set("min_weight", String(Math.max(1, Math.min(5, input.min_weight ?? 1))));
    params.set("min_confidence", String(Math.max(1, Math.min(5, input.min_confidence ?? 2))));
    params.set("limit", String(Math.max(1, Math.min(200, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/imagined-futures?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { imagined_futures?: ImaginedFuture[]; stats?: Stats };
    const rows = j.imagined_futures ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      imagined_futures: rows.map((f) => ({
        id: f.id,
        act_text: f.act_text,
        future_state: f.future_state,
        pull_kind: f.pull_kind,
        domain: f.domain,
        weight: f.weight,
        recency: f.recency,
        confidence: f.confidence,
        status: f.status,
        status_note: f.status_note,
        spoken_date: f.spoken_date,
        pinned: f.pinned,
      })),
    };
  },
});

export const respondToImaginedFutureTool = defineTool({
  name: "respond_to_imagined_future",
  description: [
    "Resolve, edit, or annotate an imagined future. Specify exactly one",
    "mode:",
    "",
    "  pursue       — THE NOVEL MOVE. Convert this imagined future into",
    "                 a PRESENT step. status_note IS the first concrete",
    "                 action the user is taking NOW (REQUIRED — server",
    "                 rejects empty). Examples:",
    "                   'I keep imagining moving to Lisbon' -> pursue",
    "                   with note 'I'm booking a 2-week scouting trip",
    "                   for next month.'",
    "                   'I picture myself writing again' -> pursue with",
    "                   note 'starting tonight: 30 minutes, no editing.'",
    "                 Use pursue when pull_kind is seeking AND the user",
    "                 has named what they're committing to RIGHT NOW.",
    "                 Don't use pursue as wishful 'maybe one day'.",
    "                 Optional pursue_intention_id links to a downstream",
    "                 intention/task created in the same flow.",
    "",
    "  release      — let the future go. status_note IS what releases",
    "                 the user from it (REQUIRED). Use when the user",
    "                 names that the imagining was an escape valve, or",
    "                 when they're choosing the present life over the",
    "                 imagined one. Examples:",
    "                   'I keep thinking about quitting' (escaping) ->",
    "                   release with note 'the imagining was just a way",
    "                   to survive the week. The actual move is to ask",
    "                   for a Friday off, not to quit.'",
    "",
    "  sitting_with — keep this alive as a live possibility without",
    "                 forcing a decision. status_note optional. Use when",
    "                 the user explicitly does NOT want to either pursue",
    "                 or release yet — when the imagining is doing",
    "                 important work the user wants to honour. The novel",
    "                 stance: refusing the binary.",
    "",
    "  grieve       — mourn a future that has already closed. status_note",
    "                 IS what they're mourning (REQUIRED — server rejects",
    "                 empty). Use when pull_kind is grieving and the user",
    "                 has named the loss. Example:",
    "                   'I keep thinking about the version of me who",
    "                   stayed in music' -> grieve with note 'mourning",
    "                   the part of me that loved being on stage. I'm",
    "                   not going back; the loss is real and I want",
    "                   to honour it.'",
    "",
    "  dismiss   — false alarm / mis-extraction by the model. Optional note.",
    "  unresolve — return to active.",
    "  pin / unpin — toggle pinned (pinned futures surface as shortcuts).",
    "  archive / restore.",
    "  edit      — fix mis-extracted facts. Optional fields: act_text,",
    "              future_state, pull_kind, weight. At least one required.",
    "",
    "Use ONLY after the user has stated a clear stance. The system holds",
    "five different stances open without forcing one. When the user is",
    "leaning toward the imagined future and has named the first step,",
    "lean toward pursue. When the user explicitly names that the",
    "imagining is doing escape work, lean toward release. When the user",
    "is in mourning territory, lean toward grieve. When the user",
    "explicitly does NOT want to decide, sitting_with is the right move.",
    "Never silently default — make the user pick.",
  ].join("\n"),
  schema: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("pursue"),
      imagined_future_id: z.string().uuid(),
      status_note: z.string().min(4, "status_note (the first concrete step you're taking) is required for pursue").max(1500),
      pursue_intention_id: z.string().uuid().optional(),
    }),
    z.object({
      mode: z.literal("release"),
      imagined_future_id: z.string().uuid(),
      status_note: z.string().min(4, "status_note (what releases you from this) is required for release").max(1500),
    }),
    z.object({
      mode: z.literal("sitting_with"),
      imagined_future_id: z.string().uuid(),
      status_note: z.string().max(1500).optional(),
    }),
    z.object({
      mode: z.literal("grieve"),
      imagined_future_id: z.string().uuid(),
      status_note: z.string().min(4, "status_note (what you're mourning) is required for grieve").max(1500),
    }),
    z.object({
      mode: z.literal("dismiss"),
      imagined_future_id: z.string().uuid(),
      status_note: z.string().max(1500).optional(),
    }),
    z.object({
      mode: z.literal("unresolve"),
      imagined_future_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("pin"),
      imagined_future_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("unpin"),
      imagined_future_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("archive"),
      imagined_future_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("restore"),
      imagined_future_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("edit"),
      imagined_future_id: z.string().uuid(),
      act_text: z.string().min(4).max(220).optional(),
      future_state: z.string().min(4).max(360).optional(),
      pull_kind: z.enum(["seeking", "escaping", "grieving", "entertaining"]).optional(),
      weight: z.number().int().min(1).max(5).optional(),
    }),
  ]),
  inputSchema: {
    type: "object",
    required: ["mode", "imagined_future_id"],
    properties: {
      mode: { type: "string", enum: ["pursue", "release", "sitting_with", "grieve", "dismiss", "unresolve", "pin", "unpin", "archive", "restore", "edit"] },
      imagined_future_id: { type: "string" },
      status_note: { type: "string", description: "REQUIRED for pursue (first concrete step), release (what releases you), and grieve (what you're mourning); optional for sitting_with and dismiss." },
      pursue_intention_id: { type: "string", description: "Optional UUID of a downstream intention/task created when pursuing." },
      act_text: { type: "string" },
      future_state: { type: "string" },
      pull_kind: { type: "string", enum: ["seeking", "escaping", "grieving", "entertaining"] },
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
    if (input.mode === "pursue") {
      body.status_note = input.status_note;
      if (input.pursue_intention_id) body.pursue_intention_id = input.pursue_intention_id;
    } else if (input.mode === "release" || input.mode === "grieve") {
      body.status_note = input.status_note;
    } else if (input.mode === "sitting_with" || input.mode === "dismiss") {
      if (input.status_note) body.status_note = input.status_note;
    } else if (input.mode === "edit") {
      if (input.act_text) body.act_text = input.act_text;
      if (input.future_state) body.future_state = input.future_state;
      if (input.pull_kind) body.pull_kind = input.pull_kind;
      if (typeof input.weight === "number") body.weight = input.weight;
    }

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/imagined-futures/${input.imagined_future_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { imagined_future?: ImaginedFuture };
    const f = j.imagined_future;
    if (!f) return { ok: false, error: "no imagined_future returned" };
    return {
      ok: true,
      imagined_future_id: f.id,
      status: f.status,
      status_note: f.status_note,
      pursue_intention_id: f.pursue_intention_id,
      pinned: f.pinned,
      archived_at: f.archived_at,
      act_text: f.act_text,
      future_state: f.future_state,
      pull_kind: f.pull_kind,
      weight: f.weight,
    };
  },
});
