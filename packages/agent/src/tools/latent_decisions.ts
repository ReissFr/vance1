// Brain tools for Latent Decisions — surfacing decisions the user has made
// BY DEFAULT. Most users TRACK decisions explicitly. The most consequential
// ones are often invisible: they stopped texting that friend, they stopped
// running, the side project they used to be obsessed with hasn't been
// mentioned in eight weeks. The scanner compares two windows of evidence
// (people-interactions, habits, themes, reflections, standups) and asks
// the model to NAME the decisions in the user's voice. The user can
// acknowledge, contest, dismiss, or materialise into a real decisions row.

import { z } from "zod";
import { defineTool } from "./types";

type LatentDecision = {
  id: string;
  scan_id: string | null;
  kind: string;
  label: string;
  candidate_decision: string;
  evidence_summary: string | null;
  strength: number;
  source_signal: string | null;
  user_status: string | null;
  user_note: string | null;
  resulting_decision_id: string | null;
  pinned: boolean;
  archived_at: string | null;
  resolved_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

export const scanLatentDecisionsTool = defineTool({
  name: "scan_latent_decisions",
  description: [
    "Run a LATENT-DECISION SCAN — compare two windows of the user's",
    "journal evidence (people-interactions, habits, themes, reflections,",
    "standups) and surface 0-5 decisions the user has effectively made",
    "BY DEFAULT (stopped doing, dropped, drifted from). Costs an LLM",
    "round-trip (4-10s) and reads heavily, so once a fortnight is",
    "plenty — don't run unprompted unless the user asks 'what have I",
    "stopped doing', 'what have I dropped', 'what's gone quiet in my",
    "life', 'show me decisions I've made by default'.",
    "",
    "Optional: window_old_start_days (60-365, default 180),",
    "window_old_end_days (30-180, default 90),",
    "window_new_days (14-90, default 30). The default compares",
    "[180-90 days ago] to [last 30 days].",
    "",
    "Returns inserted candidates plus signal counts. NEW candidates",
    "land as 'open' — the user must acknowledge / contest / dismiss /",
    "materialise via respond_to_latent_decision.",
  ].join("\n"),
  schema: z.object({
    window_old_start_days: z.number().int().min(60).max(365).optional(),
    window_old_end_days: z.number().int().min(30).max(180).optional(),
    window_new_days: z.number().int().min(14).max(90).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      window_old_start_days: { type: "number" },
      window_old_end_days: { type: "number" },
      window_new_days: { type: "number" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/latent-decisions/scan`, {
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
      latent_decisions?: LatentDecision[];
      signals?: { person_drops?: number; habit_drops?: number; theme_declines?: number };
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      latent_decisions: (j.latent_decisions ?? []).map((d) => ({
        id: d.id,
        kind: d.kind,
        label: d.label,
        candidate_decision: d.candidate_decision,
        evidence_summary: d.evidence_summary,
        strength: d.strength,
        source_signal: d.source_signal,
      })),
    };
  },
});

export const listLatentDecisionsTool = defineTool({
  name: "list_latent_decisions",
  description: [
    "List the user's latent decisions — choices made BY DEFAULT, surfaced",
    "by past scans. Optional: status (open | acknowledged | contested |",
    "dismissed | resolved | archived | pinned | all, default open),",
    "kind (person | theme | habit | routine | topic | practice | place |",
    "identity | other), limit (default 30, max 100).",
    "",
    "Worth calling before any heavy reflection conversation so you know",
    "what's drifted in the user's life and can speak to it. Also use",
    "when the user asks 'what latent decisions are open', 'what have I",
    "not yet acknowledged', 'show me everything I've drifted from'.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["open", "acknowledged", "contested", "dismissed", "resolved", "archived", "pinned", "all"]).optional().default("open"),
    kind: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "acknowledged", "contested", "dismissed", "resolved", "archived", "pinned", "all"] },
      kind: { type: "string" },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "open";
    const limit = Math.max(1, Math.min(100, input.limit ?? 30));

    let q = ctx.supabase
      .from("latent_decisions")
      .select("id, scan_id, kind, label, candidate_decision, evidence_summary, strength, source_signal, user_status, user_note, resulting_decision_id, pinned, archived_at, resolved_at, created_at")
      .eq("user_id", ctx.userId);

    if (input.kind) q = q.eq("kind", input.kind);

    if (status === "open") q = q.is("user_status", null).is("archived_at", null);
    else if (status === "acknowledged") q = q.eq("user_status", "acknowledged");
    else if (status === "contested") q = q.eq("user_status", "contested");
    else if (status === "dismissed") q = q.eq("user_status", "dismissed");
    else if (status === "resolved") q = q.not("user_status", "is", null);
    else if (status === "archived") q = q.not("archived_at", "is", null);
    else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);

    q = q.order("strength", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as unknown as LatentDecision[];

    return {
      ok: true,
      count: rows.length,
      latent_decisions: rows.map((d) => ({
        id: d.id,
        kind: d.kind,
        label: d.label,
        candidate_decision: d.candidate_decision,
        evidence_summary: d.evidence_summary,
        strength: d.strength,
        source_signal: d.source_signal,
        user_status: d.user_status,
        user_note: d.user_note,
        materialised_decision_id: d.resulting_decision_id,
        pinned: d.pinned,
        archived: d.archived_at != null,
        resolved_at: d.resolved_at,
        created_at: d.created_at,
      })),
    };
  },
});

export const respondToLatentDecisionTool = defineTool({
  name: "respond_to_latent_decision",
  description: [
    "Resolve an open latent decision. Specify exactly one mode:",
    "",
    "  acknowledge — yes, you've made this latent decision; it's now",
    "                explicit. Optional: user_note, materialise (true",
    "                creates a real decisions row linked back to this",
    "                latent one).",
    "  contest     — no, the evidence is misleading; here's what's",
    "                really going on. user_note recommended.",
    "  dismiss     — irrelevant / not worth surfacing. Optional",
    "                user_note.",
    "  pin / unpin — keep this visible at the top.",
    "  archive / restore — hide / unhide.",
    "",
    "Use ONLY when the user has explicitly responded to a specific",
    "candidate ('yes I have stopped running' / 'no I haven't, I just",
    "switched to cycling'). Don't guess on their behalf — when in doubt",
    "ask the user first.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    mode: z.enum(["acknowledge", "contest", "dismiss", "pin", "unpin", "archive", "restore"]),
    user_note: z.string().min(1).max(800).optional(),
    materialise: z.boolean().optional(),
    decision_choice: z.string().min(1).max(1000).optional(),
    decision_tags: z.array(z.string()).max(8).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "mode"],
    properties: {
      id: { type: "string" },
      mode: { type: "string", enum: ["acknowledge", "contest", "dismiss", "pin", "unpin", "archive", "restore"] },
      user_note: { type: "string" },
      materialise: { type: "boolean" },
      decision_choice: { type: "string" },
      decision_tags: { type: "array", items: { type: "string" } },
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
    if (input.mode === "acknowledge") {
      if (input.materialise === true) {
        payload.create_decision = true;
        if (input.decision_choice) payload.decision_choice = input.decision_choice;
        if (input.decision_tags) payload.decision_tags = input.decision_tags;
        if (input.user_note) payload.user_note = input.user_note;
      } else {
        payload.status = "acknowledged";
        if (input.user_note) payload.user_note = input.user_note;
      }
    } else if (input.mode === "contest") {
      payload.status = "contested";
      if (input.user_note) payload.user_note = input.user_note;
    } else if (input.mode === "dismiss") {
      payload.status = "dismissed";
      if (input.user_note) payload.user_note = input.user_note;
    } else if (input.mode === "pin") {
      payload.pin = true;
    } else if (input.mode === "unpin") {
      payload.pin = false;
    } else if (input.mode === "archive") {
      payload.archive = true;
    } else if (input.mode === "restore") {
      payload.restore = true;
    }

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/latent-decisions/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { latent_decision?: LatentDecision; decision_id?: string };
    if (!j.latent_decision) return { ok: false, error: "no row returned" };
    const d = j.latent_decision;
    return {
      ok: true,
      latent_decision: {
        id: d.id,
        kind: d.kind,
        label: d.label,
        user_status: d.user_status,
        user_note: d.user_note,
        materialised_decision_id: d.resulting_decision_id,
        pinned: d.pinned,
        archived: d.archived_at != null,
      },
      decision_id: j.decision_id,
    };
  },
});
