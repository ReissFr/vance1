// Brain tools for the Counter-Self Chamber — the strongest possible
// adversary, voiced against a position the user holds.
//
// The user picks a position (a decision, identity claim, theme, policy,
// reflection, or generic stance) and a challenger voice. The route
// instantiates the challenger and writes the strongest possible case
// AGAINST the position from that voice — plus the single most cutting
// line, plus 0-3 falsifiable predictions that act as trip-wires for
// future revisiting.
//
// Five voices: smart_cynic / concerned_mentor / failure_timeline_self
// / external_skeptic / peer_been_there. Voices are not interchangeable
// — each names different blind spots. Pick deliberately.
//
// User responses: engaged (rebut/integrate), deferred (logged but not
// yet ready), updated_position (the case landed, here's the new
// position), dismissed.

import { z } from "zod";
import { defineTool } from "./types";

type FalsifiablePrediction = { prediction: string; by_when: string };
type ChamberSession = {
  id: string;
  target_kind: string;
  target_id: string | null;
  target_snapshot: string;
  challenger_voice: string;
  argument_body: string;
  strongest_counterpoint: string | null;
  falsifiable_predictions: FalsifiablePrediction[];
  user_response: string | null;
  user_response_body: string | null;
  new_position_text: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

export const enterCounterSelfChamberTool = defineTool({
  name: "enter_counter_self_chamber",
  description: [
    "Enter the COUNTER-SELF CHAMBER — the user brings a position they",
    "hold and the chamber writes the strongest possible case AGAINST",
    "it from a chosen challenger voice. Costs an LLM round-trip",
    "(4-8s). Use when the user says 'argue against this', 'what's the",
    "case against my plan', 'what would [some adversary] say', 'I",
    "want my position stress-tested', 'tell me why I'm wrong'.",
    "",
    "target_kind: one of decision | identity_claim | theme | policy |",
    "reflection | generic. For non-generic kinds, target_id is",
    "required (the row to challenge). For 'generic', target_snapshot",
    "is required (the position in plain text).",
    "",
    "challenger_voice (pick deliberately, voices are not",
    "interchangeable):",
    "  smart_cynic           — assumes the worst about motives, names",
    "                          ego/self-deception/status-games.",
    "  concerned_mentor      — kind but firm, names blind spots.",
    "  failure_timeline_self — first-person from the user who pursued",
    "                          this exact position and watched it",
    "                          fall apart.",
    "  external_skeptic      — outsider, no skin in the game, finds",
    "                          the holes a stranger would find.",
    "  peer_been_there       — peer six steps further down a similar",
    "                          road, trades rather than lectures.",
    "",
    "Returns argument_body + strongest_counterpoint (the line to sit",
    "with) + falsifiable_predictions (trip-wires).",
  ].join("\n"),
  schema: z.object({
    target_kind: z.enum(["decision", "identity_claim", "theme", "policy", "reflection", "generic"]),
    target_id: z.string().uuid().optional(),
    target_snapshot: z.string().min(12).max(1200).optional(),
    challenger_voice: z.enum(["smart_cynic", "concerned_mentor", "failure_timeline_self", "external_skeptic", "peer_been_there"]),
  }),
  inputSchema: {
    type: "object",
    required: ["target_kind", "challenger_voice"],
    properties: {
      target_kind: { type: "string", enum: ["decision", "identity_claim", "theme", "policy", "reflection", "generic"] },
      target_id: { type: "string" },
      target_snapshot: { type: "string" },
      challenger_voice: { type: "string", enum: ["smart_cynic", "concerned_mentor", "failure_timeline_self", "external_skeptic", "peer_been_there"] },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/counter-self`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(input),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `chamber failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { counter_self?: ChamberSession };
    if (!j.counter_self) return { ok: false, error: "no chamber session produced" };
    const c = j.counter_self;
    return {
      ok: true,
      counter_self: {
        id: c.id,
        target_kind: c.target_kind,
        target_snapshot: c.target_snapshot,
        challenger_voice: c.challenger_voice,
        argument_body: c.argument_body,
        strongest_counterpoint: c.strongest_counterpoint,
        falsifiable_predictions: c.falsifiable_predictions,
        latency_ms: c.latency_ms,
      },
    };
  },
});

export const listCounterSelfChambersTool = defineTool({
  name: "list_counter_self_chambers",
  description: [
    "List the user's chamber sessions. Optional: status (open |",
    "engaged | deferred | updated_position | dismissed | resolved |",
    "archived | pinned | all, default open), target_kind (decision |",
    "identity_claim | theme | policy | reflection | generic),",
    "limit (default 30, max 100).",
    "",
    "Worth calling before discussing a position to see if the user has",
    "already been in the chamber for it. Returns full argument bodies",
    "and trip-wires.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["open", "engaged", "deferred", "updated_position", "dismissed", "resolved", "archived", "pinned", "all"]).optional().default("open"),
    target_kind: z.enum(["decision", "identity_claim", "theme", "policy", "reflection", "generic"]).optional(),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "engaged", "deferred", "updated_position", "dismissed", "resolved", "archived", "pinned", "all"] },
      target_kind: { type: "string", enum: ["decision", "identity_claim", "theme", "policy", "reflection", "generic"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "open";
    const limit = Math.max(1, Math.min(100, input.limit ?? 30));

    let q = ctx.supabase
      .from("counter_self_chambers")
      .select("id, target_kind, target_id, target_snapshot, challenger_voice, argument_body, strongest_counterpoint, falsifiable_predictions, user_response, user_response_body, new_position_text, resolved_at, pinned, archived_at, created_at")
      .eq("user_id", ctx.userId);

    if (input.target_kind) q = q.eq("target_kind", input.target_kind);

    if (status === "open") q = q.is("user_response", null).is("archived_at", null);
    else if (status === "engaged") q = q.eq("user_response", "engaged");
    else if (status === "deferred") q = q.eq("user_response", "deferred");
    else if (status === "updated_position") q = q.eq("user_response", "updated_position");
    else if (status === "dismissed") q = q.eq("user_response", "dismissed");
    else if (status === "resolved") q = q.not("user_response", "is", null);
    else if (status === "archived") q = q.not("archived_at", "is", null);
    else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);

    q = q.order("created_at", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as unknown as ChamberSession[];

    return {
      ok: true,
      count: rows.length,
      counter_self_chambers: rows.map((c) => ({
        id: c.id,
        target_kind: c.target_kind,
        target_snapshot: c.target_snapshot,
        challenger_voice: c.challenger_voice,
        argument_body: c.argument_body,
        strongest_counterpoint: c.strongest_counterpoint,
        falsifiable_predictions: c.falsifiable_predictions,
        user_response: c.user_response,
        user_response_body: c.user_response_body,
        new_position_text: c.new_position_text,
        pinned: c.pinned,
        archived: c.archived_at != null,
      })),
    };
  },
});

export const respondToCounterSelfTool = defineTool({
  name: "respond_to_counter_self",
  description: [
    "Resolve a chamber session. Modes:",
    "  engaged          — write a rebuttal or integration of the",
    "                     challenger's case. user_response_body",
    "                     required.",
    "  deferred         — logged but not yet ready to engage.",
    "  updated_position — the case landed, the user is now holding a",
    "                     different position. new_position_text",
    "                     required.",
    "  dismissed        — the case missed. Optional user_response_body.",
    "  pin / unpin / archive / restore.",
    "",
    "Use ONLY when the user has explicitly responded to a specific",
    "chamber session. Don't guess on their behalf.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    mode: z.enum(["engaged", "deferred", "updated_position", "dismissed", "pin", "unpin", "archive", "restore"]),
    user_response_body: z.string().min(1).max(2000).optional(),
    new_position_text: z.string().min(8).max(1200).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "mode"],
    properties: {
      id: { type: "string" },
      mode: { type: "string", enum: ["engaged", "deferred", "updated_position", "dismissed", "pin", "unpin", "archive", "restore"] },
      user_response_body: { type: "string" },
      new_position_text: { type: "string" },
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
    if (input.mode === "engaged") {
      if (!input.user_response_body) return { ok: false, error: "user_response_body required for mode=engaged" };
      payload.response = "engaged";
      payload.user_response_body = input.user_response_body;
    } else if (input.mode === "deferred") {
      payload.response = "deferred";
      if (input.user_response_body) payload.user_response_body = input.user_response_body;
    } else if (input.mode === "updated_position") {
      if (!input.new_position_text) return { ok: false, error: "new_position_text required for mode=updated_position" };
      payload.response = "updated_position";
      payload.new_position_text = input.new_position_text;
      if (input.user_response_body) payload.user_response_body = input.user_response_body;
    } else if (input.mode === "dismissed") {
      payload.response = "dismissed";
      if (input.user_response_body) payload.user_response_body = input.user_response_body;
    } else if (input.mode === "pin") payload.pin = true;
    else if (input.mode === "unpin") payload.pin = false;
    else if (input.mode === "archive") payload.archive = true;
    else if (input.mode === "restore") payload.restore = true;

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/counter-self/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { counter_self?: ChamberSession };
    if (!j.counter_self) return { ok: false, error: "no row returned" };
    const c = j.counter_self;
    return {
      ok: true,
      counter_self: {
        id: c.id,
        user_response: c.user_response,
        user_response_body: c.user_response_body,
        new_position_text: c.new_position_text,
        pinned: c.pinned,
        archived: c.archived_at != null,
      },
    };
  },
});
