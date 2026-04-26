// Brain tools for the inner monologue — observations the brain has noticed
// about the user across their journal data. Use when the user asks "what
// have you noticed about me", "anything you've spotted", "what patterns am
// I in", "tell me something about myself", or before opening a hard
// conversation where context is useful.
//
// Scans are triggered from the /observations page (or a cron). The brain
// reads what's already been written.

import { z } from "zod";
import { defineTool } from "./types";

type SourceRef = { kind: string; id: string; snippet: string };

type ObservationRow = {
  id: string;
  kind: "pattern" | "contradiction" | "blind_spot" | "growth" | "encouragement" | "question";
  body: string;
  confidence: number;
  source_refs: SourceRef[];
  window_days: number;
  pinned: boolean;
  dismissed_at: string | null;
  created_at: string;
};

export const listObservationsTool = defineTool({
  name: "list_observations",
  description: [
    "List things the brain has noticed about the user — patterns,",
    "contradictions, blind spots, growth signs, encouragements, open",
    "questions. By default returns active (non-dismissed) observations.",
    "Optional: kind filter, status filter ('active'|'pinned'|'dismissed'|",
    "'all'), limit. Use to give the user a grounded answer when they ask",
    "what's surfaced lately, or to seed reflection prompts. Each",
    "observation is grounded in source entries — surface those if useful.",
  ].join("\n"),
  schema: z.object({
    kind: z
      .enum(["pattern", "contradiction", "blind_spot", "growth", "encouragement", "question"])
      .optional(),
    status: z.enum(["active", "pinned", "dismissed", "all"]).optional().default("active"),
    limit: z.number().int().min(1).max(50).optional().default(10),
  }),
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["pattern", "contradiction", "blind_spot", "growth", "encouragement", "question"],
      },
      status: { type: "string", enum: ["active", "pinned", "dismissed", "all"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "active";
    const limit = input.limit ?? 10;
    let q = ctx.supabase
      .from("observations")
      .select("id, kind, body, confidence, source_refs, window_days, pinned, dismissed_at, created_at")
      .eq("user_id", ctx.userId);
    if (input.kind) q = q.eq("kind", input.kind);
    if (status === "active") q = q.is("dismissed_at", null);
    else if (status === "pinned") q = q.eq("pinned", true).is("dismissed_at", null);
    else if (status === "dismissed") q = q.not("dismissed_at", "is", null);
    q = q.order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as ObservationRow[];
    return {
      ok: true,
      count: rows.length,
      observations: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        body: r.body,
        confidence: r.confidence,
        window_days: r.window_days,
        pinned: r.pinned,
        dismissed: r.dismissed_at !== null,
        sources: r.source_refs,
        created_at: r.created_at,
      })),
    };
  },
});
