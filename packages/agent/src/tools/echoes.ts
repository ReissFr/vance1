// Brain tools for the Echo Journal — semantic-conceptual recall of "you've
// felt this before". When the user writes a reflection, makes a decision,
// or jots a non-empty daily check-in note, the brain can scan their prior
// entries and surface the conceptually closest historical matches. Not
// keyword matches — pattern matches. Same emotional loop, same recurring
// frustration, same insight in different words, sometimes years apart.
//
// Use these tools when the user says "have I felt this before", "have I
// said this before", "what is this reminding me of", or after the user
// logs a heavy reflection so the brain can ask "this echoes something you
// wrote on X — is the same thing keeping it stuck?".

import { z } from "zod";
import { defineTool } from "./types";

type EchoRow = {
  id: string;
  source_kind: "reflection" | "decision" | "daily_checkin";
  source_id: string;
  source_text_excerpt: string;
  source_date: string;
  match_kind: "reflection" | "decision" | "daily_checkin";
  match_id: string;
  match_text_excerpt: string;
  match_date: string;
  similarity: number;
  similarity_note: string;
  user_note: string | null;
  dismissed_at: string | null;
  created_at: string;
};

type ScanResponse = {
  generated?: EchoRow[];
  skipped_existing?: number;
  note?: string;
};

export const findEchoesTool = defineTool({
  name: "find_echoes",
  description: [
    "Scan the user's recent narrative entries (reflections, decisions,",
    "non-empty daily check-in notes) and surface conceptually matching",
    "older entries. Returns echo pairs with a similarity score 1-5 and a",
    "one-line note explaining what makes them echo.",
    "",
    "Two modes:",
    "- Bulk:   omit source_kind / source_id. Scans every recent entry in",
    "          the last `since_days` (default 14) and finds up to",
    "          `max_per_source` (default 3) echoes for each. Use this",
    "          when the user says 'find any echoes from this week' or",
    "          when no specific entry is named.",
    "- Single: pass source_kind ('reflection' | 'decision' |",
    "          'daily_checkin') + source_id (the uuid of the entry to",
    "          find echoes for). Use this when the user references a",
    "          specific entry ('does this remind me of anything', 'have",
    "          I written about this before').",
    "",
    "Optional: lookback_days (60-1095, default 365). Re-running won't",
    "duplicate already-stored echoes. Returns count of new echoes plus",
    "a preview of the top 3.",
  ].join("\n"),
  schema: z.object({
    source_kind: z.enum(["reflection", "decision", "daily_checkin"]).optional(),
    source_id: z.string().uuid().optional(),
    since_days: z.number().int().min(1).max(60).optional(),
    max_per_source: z.number().int().min(1).max(5).optional(),
    max: z.number().int().min(1).max(10).optional(),
    lookback_days: z.number().int().min(60).max(1095).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      source_kind: { type: "string", enum: ["reflection", "decision", "daily_checkin"] },
      source_id: { type: "string" },
      since_days: { type: "number" },
      max_per_source: { type: "number" },
      max: { type: "number" },
      lookback_days: { type: "number" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) {
      return { ok: false, error: "no session token; ask the user to open /echoes" };
    }
    const isSingle = !!(input.source_kind && input.source_id);
    const payload: Record<string, unknown> = {};
    if (isSingle) {
      payload.source_kind = input.source_kind;
      payload.source_id = input.source_id;
      if (input.max) payload.max = input.max;
    } else {
      payload.since_days = input.since_days ?? 14;
      payload.max_per_source = input.max_per_source ?? 3;
    }
    if (input.lookback_days) payload.lookback_days = input.lookback_days;

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/echoes/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `echo scan failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as ScanResponse;
    const generated = j.generated ?? [];
    return {
      ok: true,
      count: generated.length,
      skipped_existing: j.skipped_existing ?? 0,
      note: j.note ?? null,
      preview: generated.slice(0, 3).map((g) => ({
        id: g.id,
        source_kind: g.source_kind,
        source_date: g.source_date,
        match_kind: g.match_kind,
        match_date: g.match_date,
        similarity: g.similarity,
        similarity_note: g.similarity_note,
      })),
    };
  },
});

export const listEchoesTool = defineTool({
  name: "list_echoes",
  description: [
    "List the user's stored echo pairs. Optional: status (open |",
    "dismissed | all, default open); source_kind (reflection | decision",
    "| daily_checkin); source_id (uuid — list echoes FOR one specific",
    "entry); min_similarity (1-5); limit (default 50). Returns each",
    "echo with both sides' kind/date/excerpt, similarity, and note.",
    "",
    "Use when the user asks 'what have I felt before', 'show me echoes",
    "of [topic]', 'what does this remind me of', or before drafting a",
    "response to a hard reflection so the brain can surface 'this is",
    "the third time you've said this — what's actually stuck?'.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["open", "dismissed", "all"]).optional().default("open"),
    source_kind: z.enum(["reflection", "decision", "daily_checkin"]).optional(),
    source_id: z.string().uuid().optional(),
    min_similarity: z.number().int().min(1).max(5).optional(),
    limit: z.number().int().min(1).max(200).optional().default(50),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "dismissed", "all"] },
      source_kind: { type: "string", enum: ["reflection", "decision", "daily_checkin"] },
      source_id: { type: "string" },
      min_similarity: { type: "number" },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "open";
    const limit = input.limit ?? 50;
    let q = ctx.supabase
      .from("echoes")
      .select(
        "id, source_kind, source_id, source_text_excerpt, source_date, match_kind, match_id, match_text_excerpt, match_date, similarity, similarity_note, user_note, dismissed_at, created_at",
      )
      .eq("user_id", ctx.userId);
    if (status === "open") q = q.is("dismissed_at", null);
    else if (status === "dismissed") q = q.not("dismissed_at", "is", null);
    if (input.source_kind) q = q.eq("source_kind", input.source_kind);
    if (input.source_id) q = q.eq("source_id", input.source_id);
    if (input.min_similarity) q = q.gte("similarity", input.min_similarity);
    q = q.order("source_date", { ascending: false }).order("similarity", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as EchoRow[];
    return {
      ok: true,
      count: rows.length,
      echoes: rows.map((r) => ({
        id: r.id,
        source_kind: r.source_kind,
        source_id: r.source_id,
        source_text_excerpt: r.source_text_excerpt,
        source_date: r.source_date,
        match_kind: r.match_kind,
        match_id: r.match_id,
        match_text_excerpt: r.match_text_excerpt,
        match_date: r.match_date,
        similarity: r.similarity,
        similarity_note: r.similarity_note,
        user_note: r.user_note,
        dismissed_at: r.dismissed_at,
      })),
    };
  },
});
