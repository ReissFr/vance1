// Shared read-and-summarize helper used by both the reading-list API route
// (apps/web) and the save_link brain tool. Fetches the URL, strips HTML,
// and asks Haiku for a 2-3 sentence summary. Falls back gracefully so
// bot-blocked / paywalled pages still land in the queue.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 400;
const MAX_CHARS = 8000;
const FETCH_TIMEOUT_MS = 15_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36";

export type ReadResult = {
  title: string | null;
  source_domain: string | null;
  summary: string | null;
  fetch_error: string | null;
};

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function extractTitleTag(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1]) return og[1].trim();
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return t?.[1]?.trim() ?? null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(url: string): Promise<{ html: string | null; error: string | null }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-GB,en;q=0.9",
      },
    });
    if (!res.ok) return { html: null, error: `HTTP ${res.status}` };
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html")) return { html: null, error: `non-html content (${ct})` };
    const html = await res.text();
    return { html, error: null };
  } catch (e) {
    return { html: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}

async function summarize(
  title: string | null,
  bodyText: string,
): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  const prompt = [
    "Summarize this article in 2-3 sentences. Focus on what the reader will actually learn or what happened, not the page structure. Plain prose, no bullet points, no 'the article discusses' framing.",
    "",
    title ? `Title: ${title}` : "",
    "",
    "Article:",
    bodyText.slice(0, MAX_CHARS),
  ]
    .filter(Boolean)
    .join("\n");

  const make = async (model: string) =>
    anthropic.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    });

  let res;
  try {
    res = await make(MODEL);
  } catch {
    res = await make(FALLBACK_MODEL);
  }
  return res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n")
    .trim();
}

export async function readAndSummarize(url: string): Promise<ReadResult> {
  const domain = extractDomain(url);
  const { html, error } = await fetchPage(url);
  if (!html) {
    return {
      title: null,
      source_domain: domain,
      summary: null,
      fetch_error: error ?? "unknown fetch error",
    };
  }
  const title = extractTitleTag(html);
  const body = stripHtml(html);
  if (body.length < 200) {
    return {
      title,
      source_domain: domain,
      summary: null,
      fetch_error: `page too short (${body.length} chars — likely paywall or JS app)`,
    };
  }
  try {
    const summary = await summarize(title, body);
    return {
      title,
      source_domain: domain,
      summary: summary || null,
      fetch_error: null,
    };
  } catch (e) {
    return {
      title,
      source_domain: domain,
      summary: null,
      fetch_error: `summarizer error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
