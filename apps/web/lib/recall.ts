// Total Recall — unified ingestion + search layer.
//
// Every life artefact (emails, chat turns, calendar events, WhatsApp,
// meeting transcripts, screen OCR) funnels through `ingestEvent` into a
// single `recall_events` table with a voyage embedding. `searchRecall`
// ranks by cosine similarity and lets the brain answer "what did Tom say
// about pricing 3 months ago?" in one tool call.

import type { SupabaseClient } from "@supabase/supabase-js";
import { makeVoyageEmbed } from "@jarvis/agent";
import { google } from "googleapis";

export type RecallSource =
  | "email"
  | "chat"
  | "calendar"
  | "whatsapp"
  | "screen"
  | "meeting"
  | "note";

export interface RecallEventInput {
  userId: string;
  source: RecallSource;
  externalId?: string | null;
  title?: string | null;
  body: string;
  participants?: string[];
  occurredAt: string; // ISO
  url?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecallEvent {
  id: string;
  source: RecallSource;
  external_id: string | null;
  title: string | null;
  body: string;
  participants: string[];
  occurred_at: string;
  url: string | null;
  metadata: Record<string, unknown> | null;
  similarity?: number;
}

const EMBED_MAX_CHARS = 6000;

function makeEmbedder(): (text: string) => Promise<number[]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY missing");
  return makeVoyageEmbed(key);
}

export async function ingestEvent(
  admin: SupabaseClient,
  input: RecallEventInput,
  embed: (text: string) => Promise<number[]> = makeEmbedder(),
): Promise<void> {
  // Embedding input combines title + body so a subject-line search hits.
  const composed = `${input.title ?? ""}\n${input.body}`.slice(0, EMBED_MAX_CHARS);
  if (!composed.trim()) return;
  const embedding = await embed(composed);

  // Upsert by (user_id, source, external_id) when we have one — idempotent
  // re-sync. If no external_id (e.g. ad-hoc screen snapshot), just insert.
  const row = {
    user_id: input.userId,
    source: input.source,
    external_id: input.externalId ?? null,
    title: input.title ?? null,
    body: input.body.slice(0, 20000),
    participants: input.participants ?? [],
    occurred_at: input.occurredAt,
    url: input.url ?? null,
    embedding,
    metadata: input.metadata ?? null,
  };

  if (input.externalId) {
    await admin
      .from("recall_events")
      .upsert(row, { onConflict: "user_id,source,external_id", ignoreDuplicates: false });
  } else {
    await admin.from("recall_events").insert(row);
  }
}

export interface SearchOptions {
  sources?: RecallSource[];
  sinceISO?: string;
  matchCount?: number;
}

export async function searchRecall(
  admin: SupabaseClient,
  userId: string,
  query: string,
  opts: SearchOptions = {},
  embed: (text: string) => Promise<number[]> = makeEmbedder(),
): Promise<RecallEvent[]> {
  const embedding = await embed(query.slice(0, EMBED_MAX_CHARS));
  const { data, error } = await admin.rpc("match_recall_events", {
    p_user_id: userId,
    p_query_embedding: embedding,
    p_match_count: opts.matchCount ?? 12,
    p_sources: opts.sources ?? null,
    p_since: opts.sinceISO ?? null,
  });
  if (error) throw new Error(`searchRecall: ${error.message}`);
  return (data ?? []) as RecallEvent[];
}

// ── Source adapters ────────────────────────────────────────────────────────

async function getGoogleAccessToken(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("profiles")
    .select("google_access_token")
    .eq("id", userId)
    .maybeSingle();
  return (data?.google_access_token as string | undefined) ?? null;
}

async function getCursor(
  admin: SupabaseClient,
  userId: string,
  source: RecallSource,
): Promise<string | null> {
  const { data } = await admin
    .from("recall_cursors")
    .select("last_synced_at")
    .eq("user_id", userId)
    .eq("source", source)
    .maybeSingle();
  return (data?.last_synced_at as string | undefined) ?? null;
}

async function setCursor(
  admin: SupabaseClient,
  userId: string,
  source: RecallSource,
  lastSyncedAt: string,
  lastExternalId?: string,
): Promise<void> {
  await admin.from("recall_cursors").upsert(
    {
      user_id: userId,
      source,
      last_synced_at: lastSyncedAt,
      last_external_id: lastExternalId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,source" },
  );
}

export interface SyncResult {
  source: RecallSource;
  ingested: number;
  skipped: number;
  error?: string;
}

export async function syncGmail(
  admin: SupabaseClient,
  userId: string,
  opts: { maxMessages?: number } = {},
): Promise<SyncResult> {
  const result: SyncResult = { source: "email", ingested: 0, skipped: 0 };
  try {
    const token = await getGoogleAccessToken(admin, userId);
    if (!token) {
      result.error = "google not connected";
      return result;
    }
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: token });
    const gmail = google.gmail({ version: "v1", auth });

    const cursor = await getCursor(admin, userId, "email");
    const afterDays = cursor ? daysSince(cursor) : 30;
    const q = `newer_than:${Math.max(1, afterDays)}d`;

    const list = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: opts.maxMessages ?? 100,
    });
    const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
    const embed = makeEmbedder();

    let latest = cursor ?? new Date(0).toISOString();
    for (const id of ids) {
      try {
        const d = await gmail.users.messages.get({ userId: "me", id, format: "full" });
        const headers = d.data.payload?.headers ?? [];
        const h = (name: string) =>
          headers.find((x) => x.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
        const subject = h("Subject");
        const from = h("From");
        const to = h("To");
        const dateStr = h("Date");
        const iso = new Date(dateStr || Date.now()).toISOString();
        const body = extractGmailBody(d.data.payload);
        const participants = [from, to].filter(Boolean).map((s) => s.trim()).filter(Boolean);

        await ingestEvent(
          admin,
          {
            userId,
            source: "email",
            externalId: id,
            title: subject || "(no subject)",
            body: `${from ? `From: ${from}\n` : ""}${to ? `To: ${to}\n` : ""}\n${body}`.slice(0, 20000),
            participants,
            occurredAt: iso,
            url: `https://mail.google.com/mail/u/0/#inbox/${id}`,
            metadata: { snippet: d.data.snippet ?? null, thread_id: d.data.threadId ?? null },
          },
          embed,
        );
        result.ingested += 1;
        if (iso > latest) latest = iso;
      } catch (e) {
        result.skipped += 1;
        // Continue — one bad message shouldn't stop the batch.
      }
    }
    await setCursor(admin, userId, "email", latest);
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }
  return result;
}

export async function syncCalendar(
  admin: SupabaseClient,
  userId: string,
  opts: { daysBack?: number; daysForward?: number } = {},
): Promise<SyncResult> {
  const result: SyncResult = { source: "calendar", ingested: 0, skipped: 0 };
  try {
    const token = await getGoogleAccessToken(admin, userId);
    if (!token) {
      result.error = "google not connected";
      return result;
    }
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: token });
    const cal = google.calendar({ version: "v3", auth });

    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - (opts.daysBack ?? 60));
    const to = new Date(now);
    to.setDate(to.getDate() + (opts.daysForward ?? 30));

    const list = await cal.events.list({
      calendarId: "primary",
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    });
    const embed = makeEmbedder();

    for (const e of list.data.items ?? []) {
      try {
        const startISO = e.start?.dateTime ?? (e.start?.date ? new Date(e.start.date).toISOString() : null);
        if (!e.id || !startISO) {
          result.skipped += 1;
          continue;
        }
        const attendees = (e.attendees ?? [])
          .map((a) => a.email ?? a.displayName ?? "")
          .filter(Boolean);
        const body = [
          e.description ?? "",
          e.location ? `Location: ${e.location}` : "",
          attendees.length ? `Attendees: ${attendees.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        await ingestEvent(
          admin,
          {
            userId,
            source: "calendar",
            externalId: e.id,
            title: e.summary ?? "(untitled event)",
            body: body || (e.summary ?? ""),
            participants: attendees,
            occurredAt: startISO,
            url: e.htmlLink ?? null,
            metadata: { status: e.status ?? null, end: e.end?.dateTime ?? e.end?.date ?? null },
          },
          embed,
        );
        result.ingested += 1;
      } catch {
        result.skipped += 1;
      }
    }
    await setCursor(admin, userId, "calendar", new Date().toISOString());
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }
  return result;
}

export async function syncChat(
  admin: SupabaseClient,
  userId: string,
  opts: { sinceISO?: string; maxMessages?: number } = {},
): Promise<SyncResult> {
  const result: SyncResult = { source: "chat", ingested: 0, skipped: 0 };
  try {
    const cursor = opts.sinceISO ?? (await getCursor(admin, userId, "chat"));
    let q = admin
      .from("messages")
      .select("id, conversation_id, role, content, created_at")
      .eq("user_id", userId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: true })
      .limit(opts.maxMessages ?? 500);
    if (cursor) q = q.gt("created_at", cursor);
    const { data } = await q;

    const embed = makeEmbedder();
    let latest = cursor ?? new Date(0).toISOString();
    for (const m of data ?? []) {
      try {
        const content = (m.content as string) ?? "";
        if (!content.trim()) {
          result.skipped += 1;
          continue;
        }
        await ingestEvent(
          admin,
          {
            userId,
            source: "chat",
            externalId: m.id as string,
            title: `${m.role === "user" ? "You" : "JARVIS"} said`,
            body: content,
            occurredAt: m.created_at as string,
            metadata: { conversation_id: m.conversation_id, role: m.role },
          },
          embed,
        );
        result.ingested += 1;
        if ((m.created_at as string) > latest) latest = m.created_at as string;
      } catch {
        result.skipped += 1;
      }
    }
    if (data && data.length) await setCursor(admin, userId, "chat", latest);
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }
  return result;
}

export async function syncAll(
  admin: SupabaseClient,
  userId: string,
): Promise<SyncResult[]> {
  return [
    await syncGmail(admin, userId),
    await syncCalendar(admin, userId),
    await syncChat(admin, userId),
  ];
}

// ── helpers ────────────────────────────────────────────────────────────────

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

// Gmail bodies are MIME trees; walk them and pick the first text/plain we see,
// falling back to a stripped text/html. Good enough for embedding + display.
function extractGmailBody(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const part = payload as {
    mimeType?: string;
    body?: { data?: string };
    parts?: unknown[];
  };
  const decode = (d: string | undefined) =>
    d ? Buffer.from(d, "base64url").toString("utf-8") : "";

  if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data);
  if (part.parts) {
    // Prefer text/plain.
    for (const p of part.parts) {
      const s = extractGmailBody(p);
      if (s) return s;
    }
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return stripHtml(decode(part.body.data));
  }
  return "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
