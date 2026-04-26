// Brain tools for the Self-Mirror Stream. The user's writing is run
// through Haiku to produce a SHORT THIRD-PERSON DESCRIPTION of who they
// appear to be in a given window — not advice, not coaching, just a
// description, the way a perceptive friend who's known them for years
// might describe them after looking over their week. With multiple
// snapshots stored, the user can see drift over time.
//
// Use these tools when the user says "describe me", "how do I look
// right now", "show me a mirror", "what's been going on with me",
// "compare me now to last month", or as the closing of a heavy
// reflection cycle.

import { z } from "zod";
import { defineTool } from "./types";

type MirrorRow = {
  id: string;
  body: string;
  drift_note: string | null;
  window_days: number;
  window_start: string;
  window_end: string;
  source_counts: Record<string, number>;
  parent_id: string | null;
  user_note: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
};

export const generateSelfMirrorTool = defineTool({
  name: "generate_self_mirror",
  description: [
    "Take a fresh self-mirror — a third-person paragraph describing how",
    "the user APPEARS based on the last `window_days` of their own",
    "writing (reflections, decisions, wins, intentions, standups, daily",
    "check-ins, open questions, observations). Optionally produces a",
    "drift_note comparing this snapshot to the previous one.",
    "",
    "Optional: window_days (3-90, default 7).",
    "",
    "Use this when the user says 'describe me', 'show me a mirror',",
    "'how do I look right now', 'what's been going on with me', or as",
    "the closing of a heavy reflection cycle. Don't run this casually",
    "— it's expensive and the snapshot is dated, so call once per",
    "meaningful interval.",
    "",
    "Returns the new mirror's body + drift_note + window dates.",
  ].join("\n"),
  schema: z.object({
    window_days: z.number().int().min(3).max(90).optional().default(7),
  }),
  inputSchema: {
    type: "object",
    properties: { window_days: { type: "number" } },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) {
      return { ok: false, error: "no session token; ask the user to open /self-mirror" };
    }
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/self-mirrors`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ window_days: input.window_days ?? 7 }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `mirror failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { mirror?: MirrorRow };
    if (!j.mirror) return { ok: false, error: "no mirror produced" };
    return {
      ok: true,
      mirror: {
        id: j.mirror.id,
        body: j.mirror.body,
        drift_note: j.mirror.drift_note,
        window_days: j.mirror.window_days,
        window_start: j.mirror.window_start,
        window_end: j.mirror.window_end,
        created_at: j.mirror.created_at,
      },
    };
  },
});

export const listSelfMirrorsTool = defineTool({
  name: "list_self_mirrors",
  description: [
    "List the user's stored self-mirrors (newest first). Optional:",
    "status (active | pinned | archived | all, default active); limit",
    "(default 10). Returns id, body, drift_note, window dates, and",
    "user_note (the user's own reaction).",
    "",
    "Use when the user references a past mirror ('that mirror from last",
    "month', 'open the one I pinned'), wants to compare across time",
    "('how have I changed since the start of the year'), or before",
    "drafting a heavy reply on their behalf so the brain has a fresh",
    "third-person read of who they currently appear to be.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["active", "pinned", "archived", "all"]).optional().default("active"),
    limit: z.number().int().min(1).max(50).optional().default(10),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["active", "pinned", "archived", "all"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "active";
    const limit = input.limit ?? 10;
    let q = ctx.supabase
      .from("self_mirrors")
      .select("id, body, drift_note, window_days, window_start, window_end, source_counts, parent_id, user_note, pinned, archived_at, created_at")
      .eq("user_id", ctx.userId);
    if (status === "active") q = q.is("archived_at", null);
    else if (status === "archived") q = q.not("archived_at", "is", null);
    else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
    q = q.order("created_at", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as MirrorRow[];
    return {
      ok: true,
      count: rows.length,
      mirrors: rows.map((r) => ({
        id: r.id,
        body: r.body,
        drift_note: r.drift_note,
        window_days: r.window_days,
        window_start: r.window_start,
        window_end: r.window_end,
        user_note: r.user_note,
        pinned: r.pinned,
        created_at: r.created_at,
      })),
    };
  },
});
