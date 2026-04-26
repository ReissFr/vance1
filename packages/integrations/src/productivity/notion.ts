// NotionProvider — ProductivityProvider implementation backed by the Notion
// REST API. OAuth tokens never expire (Notion doesn't issue refresh tokens
// for internal/public integrations), so no refresh logic needed — the
// access_token stored on the integration row is used indefinitely until the
// user explicitly revokes.

import type {
  ProductivityProvider,
  ProductivitySearchResult,
  ProductivityPage,
  ProductivityDatabase,
  CreatePageInput,
  AddDatabaseRowInput,
} from "./provider";

const API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export type NotionCredentials = {
  access_token?: string | null;
  workspace_id?: string | null;
  workspace_name?: string | null;
  bot_id?: string | null;
};

export type NotionProviderOptions = {
  credentials: NotionCredentials;
};

type NotionRichText = { plain_text?: string };
type NotionTitleProp = { title?: NotionRichText[] };
type NotionBlock = {
  type?: string;
  paragraph?: { rich_text?: NotionRichText[] };
  heading_1?: { rich_text?: NotionRichText[] };
  heading_2?: { rich_text?: NotionRichText[] };
  heading_3?: { rich_text?: NotionRichText[] };
  bulleted_list_item?: { rich_text?: NotionRichText[] };
  numbered_list_item?: { rich_text?: NotionRichText[] };
  to_do?: { rich_text?: NotionRichText[]; checked?: boolean };
  quote?: { rich_text?: NotionRichText[] };
  code?: { rich_text?: NotionRichText[] };
};

export class NotionProvider implements ProductivityProvider {
  readonly providerName = "notion";
  private readonly token: string;

  constructor(opts: NotionProviderOptions) {
    const token = opts.credentials.access_token;
    if (!token) throw new Error("NotionProvider: no access_token in credentials");
    this.token = token;
  }

  async search(query: string, limit = 20): Promise<ProductivitySearchResult[]> {
    const res = await this.fetch("POST", "/search", {
      query,
      page_size: Math.max(1, Math.min(100, limit)),
    });
    const results = ((res.results as unknown[]) ?? []).map((r): ProductivitySearchResult => {
      const row = r as {
        id: string;
        object: string;
        url?: string;
        last_edited_time?: string;
        properties?: Record<string, unknown>;
        title?: NotionRichText[];
      };
      const type = row.object === "database" ? "database" : "page";
      let title = "";
      if (type === "database") {
        title = richTextToPlain(row.title ?? []);
      } else {
        const props = row.properties ?? {};
        for (const p of Object.values(props)) {
          const prop = p as { type?: string; title?: NotionRichText[] };
          if (prop.type === "title") {
            title = richTextToPlain(prop.title ?? []);
            break;
          }
        }
      }
      return {
        id: row.id,
        type,
        title: title || "(untitled)",
        url: row.url ?? "",
        last_edited: row.last_edited_time ?? null,
      };
    });
    return results;
  }

  async readPage(pageId: string): Promise<ProductivityPage> {
    const page = await this.fetch("GET", `/pages/${pageId}`);
    const blocks = await this.fetch(
      "GET",
      `/blocks/${pageId}/children?page_size=100`,
    );

    let title = "";
    const props = (page.properties ?? {}) as Record<string, NotionTitleProp & { type?: string }>;
    for (const p of Object.values(props)) {
      if (p.type === "title") {
        title = richTextToPlain(p.title ?? []);
        break;
      }
    }

    const body = blocksToPlain((blocks.results ?? []) as NotionBlock[]);
    return {
      id: page.id as string,
      title: title || "(untitled)",
      url: (page.url as string) ?? "",
      body,
      last_edited: (page.last_edited_time as string) ?? null,
    };
  }

  async createPage(input: CreatePageInput): Promise<ProductivityPage> {
    // If no parent is given, try to pick the first shared page as parent.
    // Notion's API requires a parent (page OR database OR workspace=true).
    // `workspace: true` only works if the bot has workspace-level access,
    // which standard OAuth installs don't grant — so we fall back to the
    // most-recently-edited shared page.
    let parent: Record<string, unknown>;
    if (input.parent_page_id) {
      parent = { type: "page_id", page_id: input.parent_page_id };
    } else {
      const search = await this.search("", 10);
      const firstPage = search.find((r) => r.type === "page");
      if (!firstPage) {
        throw new Error(
          "NotionProvider.createPage: no parent_page_id given and no shared pages found — share a page with the integration first",
        );
      }
      parent = { type: "page_id", page_id: firstPage.id };
    }

    const blocks = textToBlocks(input.body);
    const res = await this.fetch("POST", "/pages", {
      parent,
      properties: {
        title: {
          title: [{ type: "text", text: { content: input.title } }],
        },
      },
      children: blocks,
    });

    return {
      id: res.id as string,
      title: input.title,
      url: (res.url as string) ?? "",
      body: input.body,
      last_edited: (res.last_edited_time as string) ?? null,
    };
  }

  async appendToPage(pageId: string, text: string): Promise<void> {
    const blocks = textToBlocks(text);
    await this.fetch("PATCH", `/blocks/${pageId}/children`, {
      children: blocks,
    });
  }

  async listDatabases(limit = 20): Promise<ProductivityDatabase[]> {
    const res = await this.fetch("POST", "/search", {
      filter: { property: "object", value: "database" },
      page_size: Math.max(1, Math.min(100, limit)),
    });
    return ((res.results as unknown[]) ?? []).map((r): ProductivityDatabase => {
      const row = r as {
        id: string;
        url?: string;
        title?: NotionRichText[];
        properties?: Record<string, unknown>;
      };
      return {
        id: row.id,
        title: richTextToPlain(row.title ?? []) || "(untitled)",
        url: row.url ?? "",
        property_names: Object.keys(row.properties ?? {}),
      };
    });
  }

  async addDatabaseRow(input: AddDatabaseRowInput): Promise<ProductivityPage> {
    // Fetch database schema so we can map plain string values into Notion's
    // typed property shapes (title vs rich_text vs select vs number etc.).
    const db = await this.fetch("GET", `/databases/${input.database_id}`);
    const schema = (db.properties ?? {}) as Record<
      string,
      { type?: string; name?: string }
    >;

    const properties: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(input.properties)) {
      const spec = schema[key];
      if (!spec) continue;
      const value = String(raw);
      switch (spec.type) {
        case "title":
          properties[key] = { title: [{ type: "text", text: { content: value } }] };
          break;
        case "rich_text":
          properties[key] = {
            rich_text: [{ type: "text", text: { content: value } }],
          };
          break;
        case "number":
          properties[key] = { number: Number(value) };
          break;
        case "select":
          properties[key] = { select: { name: value } };
          break;
        case "multi_select":
          properties[key] = {
            multi_select: value.split(",").map((s) => ({ name: s.trim() })),
          };
          break;
        case "checkbox":
          properties[key] = { checkbox: value === "true" || value === "1" };
          break;
        case "url":
          properties[key] = { url: value };
          break;
        case "email":
          properties[key] = { email: value };
          break;
        case "phone_number":
          properties[key] = { phone_number: value };
          break;
        case "date":
          properties[key] = { date: { start: value } };
          break;
        default:
          // Skip unsupported property types silently — better than 400ing.
          break;
      }
    }

    const res = await this.fetch("POST", "/pages", {
      parent: { database_id: input.database_id },
      properties,
    });

    // Extract the title from the response (whatever the title prop is called).
    let title = "";
    const resProps = (res.properties ?? {}) as Record<
      string,
      NotionTitleProp & { type?: string }
    >;
    for (const p of Object.values(resProps)) {
      if (p.type === "title") {
        title = richTextToPlain(p.title ?? []);
        break;
      }
    }

    return {
      id: res.id as string,
      title,
      url: (res.url as string) ?? "",
      body: "",
      last_edited: (res.last_edited_time as string) ?? null,
    };
  }

  private async fetch(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Notion ${method} ${path} ${res.status}: ${text}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }
}

function richTextToPlain(rt: NotionRichText[]): string {
  return rt.map((r) => r.plain_text ?? "").join("");
}

function blocksToPlain(blocks: NotionBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    const rt =
      b.paragraph?.rich_text ??
      b.heading_1?.rich_text ??
      b.heading_2?.rich_text ??
      b.heading_3?.rich_text ??
      b.bulleted_list_item?.rich_text ??
      b.numbered_list_item?.rich_text ??
      b.to_do?.rich_text ??
      b.quote?.rich_text ??
      b.code?.rich_text ??
      [];
    const line = richTextToPlain(rt);
    if (!line) continue;
    if (b.type === "heading_1") parts.push(`# ${line}`);
    else if (b.type === "heading_2") parts.push(`## ${line}`);
    else if (b.type === "heading_3") parts.push(`### ${line}`);
    else if (b.type === "bulleted_list_item") parts.push(`- ${line}`);
    else if (b.type === "numbered_list_item") parts.push(`1. ${line}`);
    else if (b.type === "to_do")
      parts.push(`- [${b.to_do?.checked ? "x" : " "}] ${line}`);
    else if (b.type === "quote") parts.push(`> ${line}`);
    else parts.push(line);
  }
  return parts.join("\n");
}

// Split free text into Notion paragraph blocks (one block per line; blank
// lines produce blank paragraphs so spacing is preserved). Notion limits
// to 2000 chars per rich_text segment, so we chunk long lines.
function textToBlocks(text: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/);
  return lines.map((line) => ({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: chunkText(line).map((chunk) => ({
        type: "text",
        text: { content: chunk },
      })),
    },
  }));
}

function chunkText(s: string): string[] {
  if (!s) return [""];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += 1900) out.push(s.slice(i, i + 1900));
  return out;
}
