// Brain tools for identity claims — the user's stated and revealed
// identity, extracted from their own writing across reflections,
// decisions, themes, intentions, wins. Use when the user asks "who am
// I", "what do I value", "what do I refuse to do", "who am I becoming",
// or before drafting/scheduling/deciding on the user's behalf so the
// brain can quote their own values back.

import { z } from "zod";
import { defineTool } from "./types";

type Claim = {
  id: string;
  kind: string;
  statement: string;
  normalized_key: string;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  source_refs: Array<{ kind: string; id: string; snippet: string }>;
  status: string;
  contradiction_note: string | null;
  user_note: string | null;
  pinned: boolean;
};

export const extractIdentityTool = defineTool({
  name: "extract_identity",
  description: [
    "Run a fresh identity extraction over the user's recent writing.",
    "Pulls reflections, decisions, themes, intentions, wins from the",
    "selected window and asks Haiku to surface I-am, I-value, I-refuse,",
    "I'm-becoming, I-aspire claims grounded in actual entries.",
    "",
    "Re-running merges into existing claims (occurrence count bumps,",
    "last_seen updates). Claims unseen for 60+ days drift to dormant.",
    "",
    "Optional: window_days (30/60/90/180/365, default 90).",
    "",
    "Use when the user asks 'extract identity', 'refresh who I am',",
    "'what's my identity graph', or after a long stretch of journaling.",
  ].join("\n"),
  schema: z.object({
    window_days: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(180), z.literal(365)]).optional().default(90),
  }),
  inputSchema: {
    type: "object",
    properties: {
      window_days: { type: "number", enum: [30, 60, 90, 180, 365] },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (ctx.supabase as unknown as { rest: { headers: Record<string, string> } }).rest?.headers?.Authorization;
    if (!sessionToken) {
      return { ok: false, error: "no session token; ask the user to open /identity and tap Run extraction" };
    }
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/identity/extract`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ window_days: input.window_days ?? 90 }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `extract failed (${r.status}): ${err.slice(0, 200)}` };
    }
    const j = (await r.json()) as { extracted?: number; merged?: number; marked_dormant?: number; claims?: Claim[]; note?: string };
    return {
      ok: true,
      extracted: j.extracted ?? 0,
      merged: j.merged ?? 0,
      marked_dormant: j.marked_dormant ?? 0,
      total_claims: (j.claims ?? []).length,
      note: j.note ?? null,
    };
  },
});

export const listIdentityTool = defineTool({
  name: "list_identity",
  description: [
    "List the user's identity claims — who they are in their own words,",
    "extracted from their own writing. Optional: kind (am | value |",
    "refuse | becoming | aspire); status (active | dormant |",
    "contradicted | retired | all, default active+dormant+contradicted);",
    "limit (default 60).",
    "",
    "Each claim has the statement, occurrence count, first/last-seen",
    "dates, source_refs, and status. Use when the user asks 'who am",
    "I', 'what do I value', 'what do I refuse', 'who am I becoming',",
    "or BEFORE the brain drafts/schedules/decides on their behalf so",
    "the brain can ground its actions in stated values + refusals.",
  ].join("\n"),
  schema: z.object({
    kind: z.enum(["am", "value", "refuse", "becoming", "aspire"]).optional(),
    status: z.enum(["active", "dormant", "contradicted", "retired", "all", "default"]).optional().default("default"),
    limit: z.number().int().min(1).max(200).optional().default(60),
  }),
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["am", "value", "refuse", "becoming", "aspire"] },
      status: { type: "string", enum: ["active", "dormant", "contradicted", "retired", "all", "default"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "default";
    const limit = input.limit ?? 60;
    let q = ctx.supabase
      .from("identity_claims")
      .select("id, kind, statement, occurrences, first_seen_at, last_seen_at, status, contradiction_note, user_note, pinned")
      .eq("user_id", ctx.userId);
    if (input.kind) q = q.eq("kind", input.kind);
    if (status === "default") q = q.neq("status", "retired");
    else if (status !== "all") q = q.eq("status", status);
    q = q.order("pinned", { ascending: false }).order("occurrences", { ascending: false }).order("last_seen_at", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as Array<{
      id: string; kind: string; statement: string; occurrences: number; first_seen_at: string; last_seen_at: string; status: string; contradiction_note: string | null; user_note: string | null; pinned: boolean;
    }>;
    return {
      ok: true,
      count: rows.length,
      claims: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        statement: r.statement,
        occurrences: r.occurrences,
        first_seen_at: r.first_seen_at,
        last_seen_at: r.last_seen_at,
        status: r.status,
        pinned: r.pinned,
        contradiction_note: r.contradiction_note,
        user_note: r.user_note,
      })),
    };
  },
});
