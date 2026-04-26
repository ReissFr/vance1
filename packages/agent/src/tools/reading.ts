// Brain-level reading list tools. save_link fetches + summarizes + stores
// the URL in one shot. list_reading returns the current queue with summaries
// so the brain can answer "what's on my reading list?". mark_link_read
// closes one item by URL / title substring.

import { z } from "zod";
import { defineTool } from "./types";
import { readAndSummarize } from "../reading-summarize";

type ReadingRow = {
  id: string;
  url: string;
  title: string | null;
  source_domain: string | null;
  summary: string | null;
  saved_at: string;
  read_at: string | null;
  archived_at: string | null;
  fetch_error: string | null;
};

function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s.match(/^https?:\/\//i) ? s : `https://${s}`);
    return u.toString();
  } catch {
    return null;
  }
}

export const saveLinkTool = defineTool({
  name: "save_link",
  description: [
    "Save a URL to the user's reading list. Fetches the page, summarizes it",
    "in 2-3 sentences, and stores it at /reading.",
    "",
    "Use when the user says: 'save this for later', 'read-later this',",
    "'add <url> to my reading list', 'remind me to read this'.",
    "",
    "If the page can't be fetched (paywall, bot-block, JS app), the URL is",
    "still saved — just without the summary.",
  ].join("\n"),
  schema: z.object({
    url: z.string().min(4).describe("The URL to save."),
    note: z.string().max(500).optional().describe("Optional personal note attached to the save."),
  }),
  inputSchema: {
    type: "object",
    required: ["url"],
    properties: {
      url: { type: "string", description: "The URL to save." },
      note: { type: "string", description: "Optional personal note." },
    },
  },
  async run(input, ctx) {
    const url = normalizeUrl(input.url);
    if (!url) return { ok: false, error: "invalid url" };
    const note = input.note?.trim().slice(0, 500) || null;

    // If the user already saved this URL, just bump saved_at back to now and
    // clear read_at so it resurfaces in the unread queue.
    const { data: existing } = await ctx.supabase
      .from("reading_list")
      .select("id, title")
      .eq("user_id", ctx.userId)
      .eq("url", url)
      .maybeSingle();
    if (existing) {
      await ctx.supabase
        .from("reading_list")
        .update({
          saved_at: new Date().toISOString(),
          read_at: null,
          archived_at: null,
          ...(note ? { note } : {}),
        })
        .eq("id", (existing as { id: string }).id)
        .eq("user_id", ctx.userId);
      return {
        ok: true,
        duplicate: true,
        title: (existing as { title: string | null }).title,
        url,
      };
    }

    const r = await readAndSummarize(url);
    const { data: inserted, error } = await ctx.supabase
      .from("reading_list")
      .insert({
        user_id: ctx.userId,
        url,
        title: r.title,
        source_domain: r.source_domain,
        summary: r.summary,
        note,
        fetch_error: r.fetch_error,
      })
      .select("id, url, title, summary, source_domain, fetch_error")
      .single();
    if (error) return { ok: false, error: error.message };
    const row = inserted as {
      id: string;
      url: string;
      title: string | null;
      summary: string | null;
      source_domain: string | null;
      fetch_error: string | null;
    };
    return {
      ok: true,
      id: row.id,
      url: row.url,
      title: row.title,
      summary: row.summary,
      source_domain: row.source_domain,
      fetch_error: row.fetch_error,
    };
  },
});

export const listReadingTool = defineTool({
  name: "list_reading_list",
  description: [
    "List the user's reading queue. Defaults to unread items, newest first.",
    "",
    "Use when the user asks: 'what's on my reading list?', 'what did I",
    "save to read?', 'anything I've been meaning to read?'.",
  ].join("\n"),
  schema: z.object({
    filter: z.enum(["unread", "read", "all"]).optional().describe("Defaults to unread."),
    limit: z.number().int().min(1).max(30).optional().describe("Max items, default 10."),
  }),
  inputSchema: {
    type: "object",
    properties: {
      filter: {
        type: "string",
        enum: ["unread", "read", "all"],
        description: "Defaults to unread.",
      },
      limit: { type: "integer", minimum: 1, maximum: 30, description: "Default 10." },
    },
  },
  async run(input, ctx) {
    const filter = input.filter ?? "unread";
    const limit = input.limit ?? 10;
    let q = ctx.supabase
      .from("reading_list")
      .select("id, url, title, source_domain, summary, saved_at, read_at, archived_at, fetch_error")
      .eq("user_id", ctx.userId)
      .is("archived_at", null)
      .order("saved_at", { ascending: false })
      .limit(limit);
    if (filter === "unread") q = q.is("read_at", null);
    else if (filter === "read") q = q.not("read_at", "is", null);

    const { data, error } = await q;
    if (error) throw new Error(`Failed to load reading list: ${error.message}`);
    const items = (data ?? []) as ReadingRow[];
    return {
      count: items.length,
      items: items.map((it) => ({
        id: it.id,
        url: it.url,
        title: it.title,
        source_domain: it.source_domain,
        summary: it.summary,
        saved_at: it.saved_at,
        read: !!it.read_at,
      })),
    };
  },
});

export const markLinkReadTool = defineTool({
  name: "mark_link_read",
  description: [
    "Mark a reading-list item as read. Accepts a URL (exact) or a",
    "case-insensitive substring of the title.",
    "",
    "Use when the user says: 'I read the <x> piece', 'mark the Stripe",
    "article as done', 'tick off <url>'.",
  ].join("\n"),
  schema: z.object({
    match: z.string().min(2).describe("URL or title substring."),
  }),
  inputSchema: {
    type: "object",
    required: ["match"],
    properties: {
      match: { type: "string", description: "URL or title substring." },
    },
  },
  async run(input, ctx) {
    const raw = input.match.trim();
    const asUrl = normalizeUrl(raw);

    // Try URL exact match first.
    if (asUrl) {
      const { data } = await ctx.supabase
        .from("reading_list")
        .select("id, title, url")
        .eq("user_id", ctx.userId)
        .eq("url", asUrl)
        .is("read_at", null)
        .maybeSingle();
      if (data) {
        const row = data as { id: string; title: string | null; url: string };
        await ctx.supabase
          .from("reading_list")
          .update({ read_at: new Date().toISOString() })
          .eq("id", row.id)
          .eq("user_id", ctx.userId);
        return { ok: true, title: row.title, url: row.url };
      }
    }

    // Fall back to title ilike match (unread only).
    const { data: candidates } = await ctx.supabase
      .from("reading_list")
      .select("id, title, url")
      .eq("user_id", ctx.userId)
      .is("read_at", null)
      .is("archived_at", null)
      .ilike("title", `%${raw}%`)
      .order("saved_at", { ascending: false })
      .limit(5);
    const list = (candidates ?? []) as { id: string; title: string | null; url: string }[];
    if (list.length === 0) {
      return {
        ok: false,
        error: `No unread reading-list item matching "${raw}".`,
      };
    }
    if (list.length > 1) {
      return {
        ok: false,
        ambiguous: true,
        candidates: list.map((c) => ({ title: c.title, url: c.url })),
        hint: "Ask the user which one they mean, by title or URL.",
      };
    }
    const match = list[0]!;
    await ctx.supabase
      .from("reading_list")
      .update({ read_at: new Date().toISOString() })
      .eq("id", match.id)
      .eq("user_id", ctx.userId);
    return { ok: true, title: match.title, url: match.url };
  },
});
