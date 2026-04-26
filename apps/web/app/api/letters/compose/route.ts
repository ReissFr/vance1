// POST /api/letters/compose — write a letter across time (§173).
//
// Body: {
//   letter_text:  string (50-8000),
//   direction:    'to_future_self' | 'to_past_self' | 'to_younger_self',
//   target_date:  ISO date (yyyy-mm-dd) — for to_future_self this is when
//                 to deliver; for to_past_self/to_younger_self this is the
//                 date the recipient was at,
//   title?:       string (4-120),
//   prompt_used?: string (4-240),
// }
//
// Builds author_state_snapshot from current data ALWAYS. For
// to_past_self/to_younger_self also builds target_state_snapshot from
// chat history at target_date. For to_future_self schedules delivery via
// the cron poller; for past/younger marks delivered immediately.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_DIRECTIONS = new Set(["to_future_self", "to_past_self", "to_younger_self"]);

type SnapshotVow = { id: string; vow_text: string; weight: number; vow_age: string };
type SnapshotShould = { id: string; should_text: string; weight: number };
type SnapshotImagined = { id: string; act_text: string; pull_kind: string; weight: number };
type SnapshotThreshold = { id: string; threshold_text: string; charge: string; magnitude: number };

type StateSnapshot = {
  vows: SnapshotVow[];
  shoulds: SnapshotShould[];
  imagined_futures: SnapshotImagined[];
  thresholds_recent: SnapshotThreshold[];
  themes: string[];
  conversation_count: number;
  captured_at: string;
  date_window?: { from: string; to: string };
};

function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }
function isoDateOf(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDateOf(d);
}

// extract bigram themes from a list of message contents. Heuristic but
// useful — surfaces what the user kept returning to.
const STOP = new Set([
  "the", "and", "but", "for", "with", "this", "that", "have", "has", "had",
  "are", "was", "were", "been", "being", "from", "they", "them", "their",
  "then", "than", "what", "when", "where", "which", "who", "how", "why",
  "into", "onto", "out", "off", "about", "over", "under", "after", "before",
  "all", "any", "some", "more", "most", "much", "many", "few", "very", "just",
  "you", "your", "yours", "i", "me", "my", "mine", "we", "us", "our", "she",
  "he", "him", "her", "his", "hers", "it", "its", "do", "does", "did", "done",
  "doing", "say", "said", "saying", "go", "goes", "going", "went", "get",
  "got", "getting", "make", "made", "making", "be", "is", "am", "as", "of",
  "in", "on", "at", "to", "by", "or", "if", "no", "not", "yes", "so", "up",
  "down", "now", "yeah", "ok", "okay", "im", "ive", "id", "youre", "youve",
  "dont", "didnt", "wasnt", "isnt", "wouldnt", "couldnt", "shouldnt", "cant",
  "wont", "lol", "haha", "really", "actually", "kind", "stuff", "thing",
  "things", "way", "ways", "like", "likes", "well", "even", "still", "also",
]);

function extractThemes(messages: Array<{ content: string }>, limit = 5): string[] {
  const counts = new Map<string, number>();
  for (const m of messages) {
    const tokens = m.content
      .toLowerCase()
      .replace(/[^a-z\s']/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !STOP.has(t));
    for (let i = 0; i < tokens.length; i++) {
      const a = tokens[i];
      const b = tokens[i + 1];
      if (a && !STOP.has(a)) counts.set(a, (counts.get(a) ?? 0) + 1);
      if (a && b && !STOP.has(a) && !STOP.has(b)) {
        const bg = `${a} ${b}`;
        counts.set(bg, (counts.get(bg) ?? 0) + 2);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([t]) => !/^\d+$/.test(t))
    .slice(0, limit)
    .map(([t]) => t);
}

async function buildAuthorSnapshot(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  userId: string,
): Promise<StateSnapshot> {
  const today = new Date();
  const todayIso = isoDateOf(today);
  const from30 = shiftDays(todayIso, -30);

  const [vowsRes, shouldsRes, imaginedRes, thresholdsRes, messagesRes, convCountRes] = await Promise.all([
    supabase.from("vows").select("id, vow_text, weight, vow_age, status, archived_at").eq("user_id", userId).eq("status", "active").is("archived_at", null).gte("weight", 3).order("weight", { ascending: false }).limit(10),
    supabase.from("shoulds").select("id, should_text, weight, status, archived_at").eq("user_id", userId).eq("status", "active").is("archived_at", null).order("weight", { ascending: false }).limit(5),
    supabase.from("imagined_futures").select("id, act_text, pull_kind, weight, status, archived_at").eq("user_id", userId).eq("status", "active").is("archived_at", null).order("weight", { ascending: false }).limit(5),
    supabase.from("thresholds").select("id, threshold_text, charge, magnitude, spoken_date, status, archived_at").eq("user_id", userId).is("archived_at", null).gte("spoken_date", from30).order("spoken_date", { ascending: false }).limit(8),
    supabase.from("messages").select("content").eq("user_id", userId).eq("role", "user").gte("created_at", `${from30}T00:00:00Z`).limit(800),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", `${from30}T00:00:00Z`),
  ]);

  return {
    vows: (vowsRes.data ?? []).map((v) => ({ id: v.id, vow_text: v.vow_text, weight: v.weight, vow_age: v.vow_age })),
    shoulds: (shouldsRes.data ?? []).map((s) => ({ id: s.id, should_text: s.should_text, weight: s.weight })),
    imagined_futures: (imaginedRes.data ?? []).map((f) => ({ id: f.id, act_text: f.act_text, pull_kind: f.pull_kind, weight: f.weight })),
    thresholds_recent: (thresholdsRes.data ?? []).map((t) => ({ id: t.id, threshold_text: t.threshold_text, charge: t.charge, magnitude: t.magnitude })),
    themes: extractThemes(messagesRes.data ?? []),
    conversation_count: convCountRes.count ?? 0,
    captured_at: new Date().toISOString(),
    date_window: { from: from30, to: todayIso },
  };
}

async function buildTargetSnapshot(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  userId: string,
  targetDateIso: string,
): Promise<StateSnapshot> {
  const from = shiftDays(targetDateIso, -30);
  const to = shiftDays(targetDateIso, 30);

  const [vowsRes, shouldsRes, imaginedRes, thresholdsRes, messagesRes, convCountRes] = await Promise.all([
    supabase.from("vows").select("id, vow_text, weight, vow_age, spoken_date").eq("user_id", userId).gte("spoken_date", from).lte("spoken_date", to).order("weight", { ascending: false }).limit(10),
    supabase.from("shoulds").select("id, should_text, weight, spoken_date").eq("user_id", userId).gte("spoken_date", from).lte("spoken_date", to).order("weight", { ascending: false }).limit(5),
    supabase.from("imagined_futures").select("id, act_text, pull_kind, weight, spoken_date").eq("user_id", userId).gte("spoken_date", from).lte("spoken_date", to).order("weight", { ascending: false }).limit(5),
    supabase.from("thresholds").select("id, threshold_text, charge, magnitude, spoken_date").eq("user_id", userId).gte("spoken_date", from).lte("spoken_date", to).order("magnitude", { ascending: false }).limit(8),
    supabase.from("messages").select("content").eq("user_id", userId).eq("role", "user").gte("created_at", `${from}T00:00:00Z`).lte("created_at", `${to}T23:59:59Z`).limit(800),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", `${from}T00:00:00Z`).lte("created_at", `${to}T23:59:59Z`),
  ]);

  return {
    vows: (vowsRes.data ?? []).map((v) => ({ id: v.id, vow_text: v.vow_text, weight: v.weight, vow_age: v.vow_age })),
    shoulds: (shouldsRes.data ?? []).map((s) => ({ id: s.id, should_text: s.should_text, weight: s.weight })),
    imagined_futures: (imaginedRes.data ?? []).map((f) => ({ id: f.id, act_text: f.act_text, pull_kind: f.pull_kind, weight: f.weight })),
    thresholds_recent: (thresholdsRes.data ?? []).map((t) => ({ id: t.id, threshold_text: t.threshold_text, charge: t.charge, magnitude: t.magnitude })),
    themes: extractThemes(messagesRes.data ?? []),
    conversation_count: convCountRes.count ?? 0,
    captured_at: new Date().toISOString(),
    date_window: { from, to },
  };
}

export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { letter_text?: unknown; direction?: unknown; target_date?: unknown; title?: unknown; prompt_used?: unknown };
  try { body = (await req.json()) as typeof body; } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const letterText = typeof body.letter_text === "string" ? body.letter_text.trim() : "";
  if (letterText.length < 50 || letterText.length > 8000) {
    return NextResponse.json({ error: "letter_text must be 50-8000 characters" }, { status: 400 });
  }

  const direction = typeof body.direction === "string" ? body.direction : "";
  if (!VALID_DIRECTIONS.has(direction)) {
    return NextResponse.json({ error: `direction must be one of ${[...VALID_DIRECTIONS].join("/")}` }, { status: 400 });
  }

  const targetDate = typeof body.target_date === "string" ? body.target_date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return NextResponse.json({ error: "target_date must be ISO yyyy-mm-dd" }, { status: 400 });
  }
  const targetTs = new Date(`${targetDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(targetTs)) {
    return NextResponse.json({ error: "target_date is not a valid date" }, { status: 400 });
  }
  const todayIso = isoDateOf(new Date());
  if (direction === "to_future_self" && targetDate <= todayIso) {
    return NextResponse.json({ error: "to_future_self letters need target_date in the future" }, { status: 400 });
  }
  if ((direction === "to_past_self" || direction === "to_younger_self") && targetDate >= todayIso) {
    return NextResponse.json({ error: "letters to past/younger self need target_date in the past" }, { status: 400 });
  }

  const title = typeof body.title === "string" && body.title.trim().length >= 4 ? body.title.trim().slice(0, 120) : null;
  const promptUsed = typeof body.prompt_used === "string" && body.prompt_used.trim().length >= 4 ? body.prompt_used.trim().slice(0, 240) : null;

  const authorSnapshot = await buildAuthorSnapshot(supabase, user.id);
  const targetSnapshot =
    direction === "to_past_self" || direction === "to_younger_self"
      ? await buildTargetSnapshot(supabase, user.id, targetDate)
      : null;

  const isPastDirection = direction === "to_past_self" || direction === "to_younger_self";
  const nowIso = new Date().toISOString();

  const { data: row, error } = await supabase
    .from("letters")
    .insert({
      user_id: user.id,
      letter_text: letterText,
      direction,
      target_date: targetDate,
      title,
      prompt_used: promptUsed,
      author_state_snapshot: authorSnapshot,
      target_state_snapshot: targetSnapshot,
      // letters to past/younger don't get scheduled — they're written and
      // archived immediately. Letters to future selves stay scheduled.
      status: isPastDirection ? "delivered" : "scheduled",
      delivered_at: isPastDirection ? nowIso : null,
      delivery_channels: isPastDirection ? { web: true } : null,
    })
    .select("id, letter_text, direction, target_date, title, prompt_used, author_state_snapshot, target_state_snapshot, status, delivered_at, pinned, delivery_channels, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, letter: row });
}
