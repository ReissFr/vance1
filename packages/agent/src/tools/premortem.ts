// Brain tools for decision pre-mortems. The user logs a decision; the
// brain runs a pre-mortem (Haiku-generated failure modes), the user
// watches them, and marks each as happened / avoided / dismissed as the
// decision plays out. This makes "I should have seen that coming" much
// rarer.
//
// Use the run tool right after the user logs a non-trivial decision, or
// when they say "what could go wrong with X", "stress test this", "what
// am I missing", "pre-mortem this".

import { z } from "zod";
import { defineTool } from "./types";

type PremortemRow = {
  id: string;
  decision_id: string;
  failure_mode: string;
  likelihood: number;
  mitigation: string | null;
  status: "watching" | "happened" | "avoided" | "dismissed";
  resolved_at: string | null;
  resolved_note: string | null;
  created_at: string;
};

export const runPremortemTool = defineTool({
  name: "run_premortem",
  description: [
    "Generate plausible failure modes for a decision the user has logged.",
    "Required: decision_id. Optional: count (3-5, default 4), replace (if",
    "true wipes existing failure modes for this decision before inserting",
    "fresh ones).",
    "",
    "Use right after the user logs a non-trivial decision, or when they",
    "say 'what could go wrong / stress test this / pre-mortem this / what",
    "am I missing'. Each generated mode includes a likelihood (1-5) and a",
    "concrete mitigation. Returns the inserted rows so you can read them",
    "back to the user.",
  ].join("\n"),
  schema: z.object({
    decision_id: z.string().uuid(),
    count: z.number().int().min(3).max(5).optional().default(4),
    replace: z.boolean().optional().default(false),
  }),
  inputSchema: {
    type: "object",
    required: ["decision_id"],
    properties: {
      decision_id: { type: "string", description: "UUID of the decision row" },
      count: { type: "number", description: "Number of failure modes to generate (3-5)" },
      replace: { type: "boolean", description: "Wipe existing failure modes first" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (ctx.supabase as unknown as { rest: { headers: Record<string, string> } }).rest?.headers?.Authorization;
    if (!sessionToken) {
      return { ok: false, error: "no session token; ask the user to open /premortems and tap Generate" };
    }
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/decisions/${input.decision_id}/premortem`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ count: input.count ?? 4, replace: input.replace ?? false }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `generate failed (${r.status}): ${err.slice(0, 200)}` };
    }
    const j = (await r.json()) as { generated?: PremortemRow[]; note?: string };
    return {
      ok: true,
      count: j.generated?.length ?? 0,
      note: j.note ?? null,
      modes: (j.generated ?? []).map((m) => ({
        id: m.id,
        failure_mode: m.failure_mode,
        likelihood: m.likelihood,
        mitigation: m.mitigation,
      })),
    };
  },
});

export const listPremortemsTool = defineTool({
  name: "list_premortems",
  description: [
    "List pre-mortem failure modes the user is watching across decisions.",
    "Optional: decision_id to filter to one decision; status (default",
    "'watching' — the open watch list); limit. Use when the user asks",
    "'what am I watching for', 'remind me what could go wrong', or before",
    "reviewing a decision so you can ask which modes materialised.",
  ].join("\n"),
  schema: z.object({
    decision_id: z.string().uuid().optional(),
    status: z
      .enum(["watching", "happened", "avoided", "dismissed", "all"])
      .optional()
      .default("watching"),
    limit: z.number().int().min(1).max(100).optional().default(40),
  }),
  inputSchema: {
    type: "object",
    properties: {
      decision_id: { type: "string" },
      status: { type: "string", enum: ["watching", "happened", "avoided", "dismissed", "all"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "watching";
    const limit = input.limit ?? 40;
    let q = ctx.supabase
      .from("decision_premortems")
      .select("id, decision_id, failure_mode, likelihood, mitigation, status, resolved_at, resolved_note, created_at")
      .eq("user_id", ctx.userId);
    if (input.decision_id) q = q.eq("decision_id", input.decision_id);
    if (status !== "all") q = q.eq("status", status);
    q = q.order("likelihood", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as PremortemRow[];
    return {
      ok: true,
      count: rows.length,
      premortems: rows.map((r) => ({
        id: r.id,
        decision_id: r.decision_id,
        failure_mode: r.failure_mode,
        likelihood: r.likelihood,
        mitigation: r.mitigation,
        status: r.status,
        resolved_note: r.resolved_note,
        created_at: r.created_at,
      })),
    };
  },
});

export const updatePremortemStatusTool = defineTool({
  name: "update_premortem_status",
  description: [
    "Update the status of a single failure mode the user is watching.",
    "Status: 'happened' (yes, this came true), 'avoided' (the mitigation",
    "worked or the failure was averted), 'dismissed' (no longer relevant),",
    "or 'watching' (re-open). Optional note captures what actually",
    "happened — write it as the user would phrase it.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    status: z.enum(["watching", "happened", "avoided", "dismissed"]),
    note: z.string().max(500).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "status"],
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: ["watching", "happened", "avoided", "dismissed"] },
      note: { type: "string" },
    },
  },
  async run(input, ctx) {
    const update: Record<string, unknown> = {
      status: input.status,
      updated_at: new Date().toISOString(),
      resolved_at: input.status === "watching" ? null : new Date().toISOString(),
    };
    if (typeof input.note === "string") update.resolved_note = input.note.trim().slice(0, 500) || null;
    const { data, error } = await ctx.supabase
      .from("decision_premortems")
      .update(update)
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .select("id, status, resolved_note")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, premortem: data };
  },
});
