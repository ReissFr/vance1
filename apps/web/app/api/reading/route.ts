// List + create reading-list items. Create fetches the URL and summarizes
// inline (small cost, <2s for most pages) so the UI can show the summary
// immediately. If the fetch fails the row is still saved with the URL +
// fetch_error so Reiss can eyeball later.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { readAndSummarize } from "@jarvis/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

type ReadingRow = {
  id: string;
  url: string;
  title: string | null;
  source_domain: string | null;
  summary: string | null;
  note: string | null;
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

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") ?? "unread";

  let query = supabase
    .from("reading_list")
    .select("id, url, title, source_domain, summary, note, saved_at, read_at, archived_at, fetch_error")
    .eq("user_id", user.id)
    .order("saved_at", { ascending: false })
    .limit(100);

  if (filter === "unread") {
    query = query.is("read_at", null).is("archived_at", null);
  } else if (filter === "read") {
    query = query.not("read_at", "is", null).is("archived_at", null);
  } else if (filter === "archived") {
    query = query.not("archived_at", "is", null);
  }
  // "all" falls through with no extra filters.

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { count: unreadCount } = await supabase
    .from("reading_list")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null)
    .is("archived_at", null);

  return NextResponse.json({
    items: (data ?? []) as ReadingRow[],
    unread_count: unreadCount ?? 0,
  });
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const rawUrl = typeof body.url === "string" ? body.url : "";
  const url = normalizeUrl(rawUrl);
  if (!url) return NextResponse.json({ error: "invalid url" }, { status: 400 });
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : null;

  // Duplicate check — if the URL is already saved, bring it back to the top
  // of the unread queue rather than erroring.
  const { data: existing } = await supabase
    .from("reading_list")
    .select("id, url, title, summary, source_domain, saved_at, read_at, archived_at, fetch_error, note")
    .eq("user_id", user.id)
    .eq("url", url)
    .maybeSingle();
  if (existing) {
    const { data: updated } = await supabase
      .from("reading_list")
      .update({
        saved_at: new Date().toISOString(),
        read_at: null,
        archived_at: null,
        ...(note ? { note } : {}),
      })
      .eq("id", existing.id as string)
      .eq("user_id", user.id)
      .select("id, url, title, source_domain, summary, note, saved_at, read_at, archived_at, fetch_error")
      .single();
    return NextResponse.json({ item: updated, duplicate: true });
  }

  const r = await readAndSummarize(url);

  const { data: inserted, error } = await supabase
    .from("reading_list")
    .insert({
      user_id: user.id,
      url,
      title: r.title,
      source_domain: r.source_domain,
      summary: r.summary,
      note: note || null,
      fetch_error: r.fetch_error,
    })
    .select("id, url, title, source_domain, summary, note, saved_at, read_at, archived_at, fetch_error")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: inserted });
}
