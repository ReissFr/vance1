// Brain-level Notion tools via the ProductivityProvider resolver.
// Covers: search, read page, append, create page, list databases, add db row.

import { z } from "zod";
import { getProductivityProvider } from "@jarvis/integrations";
import { defineTool } from "./types";

const PROVIDERS = ["notion"] as const;

export const notionSearchTool = defineTool({
  name: "notion_search",
  description:
    "Search the user's Notion workspace for pages and databases by free-text query. Returns id, type, title, URL. Use this to find pages before reading or appending to them. An empty query returns the most recently edited items.",
  schema: z.object({
    query: z.string().default(""),
    limit: z.number().int().min(1).max(100).optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search text. Empty string returns recent items." },
      limit: { type: "number", description: "Max results, 1–100. Default 20." },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
  },
  async run(input, ctx) {
    const notion = await getProductivityProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: notion.providerName,
      results: await notion.search(input.query ?? "", input.limit ?? 20),
    };
  },
});

export const notionReadPageTool = defineTool({
  name: "notion_read_page",
  description:
    "Read the title and plain-text body of a Notion page by id. Call notion_search first if you don't know the id. Body is formatted as light markdown (headings, bullets, checkboxes).",
  schema: z.object({
    page_id: z.string().min(1),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      page_id: { type: "string", description: "Notion page id (UUID, dashed or compact)." },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["page_id"],
  },
  async run(input, ctx) {
    const notion = await getProductivityProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: notion.providerName,
      page: await notion.readPage(input.page_id),
    };
  },
});

export const notionAppendTool = defineTool({
  name: "notion_append_to_page",
  description:
    "Append plain-text paragraphs to an existing Notion page. Each line becomes a paragraph block; blank lines preserve spacing. Use to log things like daily notes, meeting summaries, action items.",
  schema: z.object({
    page_id: z.string().min(1),
    text: z.string().min(1),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      page_id: { type: "string", description: "Notion page id to append to." },
      text: { type: "string", description: "Text to append. Multi-line ok." },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["page_id", "text"],
  },
  async run(input, ctx) {
    const notion = await getProductivityProvider(ctx.supabase, ctx.userId, input.provider);
    await notion.appendToPage(input.page_id, input.text);
    return { ok: true };
  },
});

export const notionCreatePageTool = defineTool({
  name: "notion_create_page",
  description:
    "Create a new Notion page with the given title and body. If parent_page_id is omitted, the page is created under the most-recently-edited shared page. Returns the new page's url + id.",
  schema: z.object({
    title: z.string().min(1),
    body: z.string().default(""),
    parent_page_id: z.string().optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      body: { type: "string", description: "Plain-text body. Can be multi-line." },
      parent_page_id: {
        type: "string",
        description: "Optional parent page id. Omit to create under the first shared page.",
      },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["title"],
  },
  async run(input, ctx) {
    const notion = await getProductivityProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: notion.providerName,
      page: await notion.createPage({
        title: input.title,
        body: input.body ?? "",
        parent_page_id: input.parent_page_id,
      }),
    };
  },
});

export const notionListDatabasesTool = defineTool({
  name: "notion_list_databases",
  description:
    "List the user's Notion databases. Returns id, title, url, and property names (so you know what fields you can set when adding a row).",
  schema: z.object({
    limit: z.number().int().min(1).max(100).optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max results, 1–100. Default 20." },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
  },
  async run(input, ctx) {
    const notion = await getProductivityProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: notion.providerName,
      databases: await notion.listDatabases(input.limit ?? 20),
    };
  },
});

export const notionAddDatabaseRowTool = defineTool({
  name: "notion_add_database_row",
  description:
    "Add a row to a Notion database. Pass `properties` as a flat object keyed by the property names from notion_list_databases — we automatically translate values into the correct typed Notion shape (title, text, number, select, date, url, email, checkbox, etc.).",
  schema: z.object({
    database_id: z.string().min(1),
    properties: z.record(z.string(), z.string()),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      database_id: { type: "string" },
      properties: {
        type: "object",
        description:
          "Map of { propertyName: value } as strings. E.g. { Name: 'Dinner plans', Status: 'Todo', Due: '2026-05-01' }.",
        additionalProperties: { type: "string" },
      },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["database_id", "properties"],
  },
  async run(input, ctx) {
    const notion = await getProductivityProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: notion.providerName,
      row: await notion.addDatabaseRow({
        database_id: input.database_id,
        properties: input.properties,
      }),
    };
  },
});
