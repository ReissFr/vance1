import { z } from "zod";
import { defineTool } from "./types";

const DEFAULT_LAT = 51.5407;
const DEFAULT_LON = -0.0273;

const WEATHER_CODES: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "depositing rime fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  80: "rain showers",
  81: "heavy rain showers",
  82: "violent rain showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "thunderstorm with heavy hail",
};

export const weatherTool = defineTool({
  name: "weather",
  description:
    "Get current weather for a location. Defaults to East London (the user's home). Pass `location` only if the user explicitly mentions another place. Returns temperature, conditions, wind.",
  schema: z.object({
    location: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      location: { type: "string", description: "Place name. Geocoded via Open-Meteo." },
      latitude: { type: "number" },
      longitude: { type: "number" },
    },
  },
  async run(input) {
    let lat = input.latitude ?? DEFAULT_LAT;
    let lon = input.longitude ?? DEFAULT_LON;
    let label = "East London";
    if (input.location && input.latitude === undefined) {
      const g = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(input.location)}&count=1`,
      );
      const gd = (await g.json()) as { results?: { latitude: number; longitude: number; name: string; country: string }[] };
      const hit = gd.results?.[0];
      if (!hit) return { error: `could not geocode '${input.location}'` };
      lat = hit.latitude;
      lon = hit.longitude;
      label = `${hit.name}, ${hit.country}`;
    }
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min&timezone=auto`,
    );
    const d = (await r.json()) as {
      current?: { temperature_2m: number; weather_code: number; wind_speed_10m: number; relative_humidity_2m: number };
      daily?: { temperature_2m_max: number[]; temperature_2m_min: number[] };
    };
    if (!d.current) return { error: "weather fetch failed" };
    return {
      location: label,
      temperature_c: d.current.temperature_2m,
      conditions: WEATHER_CODES[d.current.weather_code] ?? `code ${d.current.weather_code}`,
      wind_kmh: d.current.wind_speed_10m,
      humidity_pct: d.current.relative_humidity_2m,
      today_high_c: d.daily?.temperature_2m_max?.[0],
      today_low_c: d.daily?.temperature_2m_min?.[0],
    };
  },
});

export const hackernewsTopTool = defineTool({
  name: "hackernews_top",
  description:
    "Fetch top Hacker News front-page stories. Returns titles, URLs, points, comment counts. Use for morning briefings or 'what's interesting in tech today'.",
  schema: z.object({ limit: z.number().int().min(1).max(30).optional() }),
  inputSchema: {
    type: "object",
    properties: { limit: { type: "number", description: "Max stories, 1–30. Default 10." } },
  },
  async run(input) {
    const limit = input.limit ?? 10;
    const r = await fetch(`https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${limit}`);
    const d = (await r.json()) as {
      hits?: { title: string; url?: string; points: number; num_comments: number; objectID: string }[];
    };
    return (d.hits ?? []).map((h) => ({
      title: h.title,
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      points: h.points,
      comments: h.num_comments,
    }));
  },
});

export const newsHeadlinesTool = defineTool({
  name: "news_headlines",
  description:
    "Fetch latest headlines from configured RSS feeds (NEWS_RSS_URLS env var, comma-separated). Defaults to BBC News if no env config. Returns titles, links, summaries.",
  schema: z.object({ limit: z.number().int().min(1).max(30).optional() }),
  inputSchema: {
    type: "object",
    properties: { limit: { type: "number", description: "Max headlines per feed, 1–30. Default 10." } },
  },
  async run(input) {
    const limit = input.limit ?? 10;
    const feedsRaw =
      process.env.NEWS_RSS_URLS ??
      "https://feeds.bbci.co.uk/news/rss.xml,https://feeds.bbci.co.uk/news/technology/rss.xml";
    const feeds = feedsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const out: { feed: string; items: { title: string; link: string; summary: string; pub: string }[] }[] = [];
    for (const url of feeds) {
      try {
        const r = await fetch(url);
        const xml = await r.text();
        const items = parseRssItems(xml).slice(0, limit);
        out.push({ feed: url, items });
      } catch (e) {
        out.push({ feed: url, items: [{ title: `(fetch failed: ${e instanceof Error ? e.message : String(e)})`, link: "", summary: "", pub: "" }] });
      }
    }
    return out;
  },
});

function parseRssItems(xml: string): { title: string; link: string; summary: string; pub: string }[] {
  const items: { title: string; link: string; summary: string; pub: string }[] = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1] ?? "";
    items.push({
      title: extractTag(block, "title"),
      link: extractTag(block, "link"),
      summary: stripHtml(extractTag(block, "description")).slice(0, 300),
      pub: extractTag(block, "pubDate"),
    });
  }
  return items;
}

function extractTag(block: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
  if (!m) return "";
  return m[1]!
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .trim();
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export const githubNotificationsTool = defineTool({
  name: "github_notifications",
  description:
    "Fetch the user's unread GitHub notifications (mentions, review requests, PR updates). Requires GITHUB_TOKEN env var with `notifications` scope.",
  schema: z.object({ all: z.boolean().optional() }),
  inputSchema: {
    type: "object",
    properties: {
      all: { type: "boolean", description: "If true, includes already-read notifications. Default false (unread only)." },
    },
  },
  async run(input) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return { error: "GITHUB_TOKEN env var not set" };
    const r = await fetch(`https://api.github.com/notifications?all=${input.all ? "true" : "false"}&per_page=30`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!r.ok) return { error: `GitHub API ${r.status}: ${await r.text()}` };
    const items = (await r.json()) as {
      reason: string;
      subject: { title: string; type: string; url: string };
      repository: { full_name: string };
      updated_at: string;
    }[];
    return items.map((n) => ({
      repo: n.repository.full_name,
      type: n.subject.type,
      reason: n.reason,
      title: n.subject.title,
      updated: n.updated_at,
      url: n.subject.url
        .replace("api.github.com/repos", "github.com")
        .replace("/pulls/", "/pull/"),
    }));
  },
});
