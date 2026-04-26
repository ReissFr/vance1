// POST /api/echoes/scan — find conceptual echoes between recent and older
// entries.
//
// Two modes:
//   1. Bulk:    body = { since_days?: number, max_per_source?: number, lookback_days?: number }
//      Scans every reflection/decision/non-empty-checkin created in the last
//      `since_days` (default 14) and finds up to `max_per_source` (default 3)
//      conceptually matching entries from older history (within `lookback_days`,
//      default 365, with a 7-day recency buffer so we don't surface near-duplicates).
//
//   2. Single:  body = { source_kind, source_id, max?: number }
//      Finds echoes for one specific entry. max defaults to 5.
//
// Returns: { generated: Echo[], skipped_existing: number, note?: string }
//
// Server-side validates that every (kind, id) pair the model returns exists in
// the dump (no fabrication), dedupes against (user, source, match) unique
// constraint, and clamps similarity to 1-5.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 2400;

const VALID_KINDS = new Set(["reflection", "decision", "daily_checkin"]);

type Entry = {
  kind: "reflection" | "decision" | "daily_checkin";
  id: string;
  date: string;
  text: string;
};

type ProposedEcho = {
  source_kind: string;
  source_id: string;
  match_kind: string;
  match_id: string;
  similarity: number;
  similarity_note: string;
};

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function isoToDate(iso: string): string {
  return iso.slice(0, 10);
}

async function loadEntriesIn(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  userId: string,
  startIso: string,
  endIso: string,
  limit: { reflections: number; decisions: number; checkins: number },
): Promise<Entry[]> {
  const startDate = startIso.slice(0, 10);
  const endDate = endIso.slice(0, 10);
  const [reflRes, decRes, chkRes] = await Promise.all([
    supabase
      .from("reflections")
      .select("id, text, kind, created_at")
      .eq("user_id", userId)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .limit(limit.reflections),
    supabase
      .from("decisions")
      .select("id, title, choice, expected_outcome, context, created_at")
      .eq("user_id", userId)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .limit(limit.decisions),
    supabase
      .from("daily_checkins")
      .select("id, log_date, energy, mood, focus, note")
      .eq("user_id", userId)
      .gte("log_date", startDate)
      .lte("log_date", endDate)
      .order("log_date", { ascending: false })
      .limit(limit.checkins),
  ]);

  const out: Entry[] = [];
  for (const r of (reflRes.data ?? []) as Array<{ id: string; text: string; kind: string | null; created_at: string }>) {
    if (!r.text || r.text.trim().length < 12) continue;
    out.push({ kind: "reflection", id: r.id, date: isoToDate(r.created_at), text: `[${r.kind ?? "reflection"}] ${r.text.replace(/\s+/g, " ")}` });
  }
  for (const r of (decRes.data ?? []) as Array<{ id: string; title: string; choice: string | null; expected_outcome: string | null; context: string | null; created_at: string }>) {
    const parts = [
      r.title,
      r.choice && `chose: ${r.choice}`,
      r.context && `context: ${r.context}`,
      r.expected_outcome && `expected: ${r.expected_outcome}`,
    ].filter(Boolean).join(" — ");
    if (parts.length < 12) continue;
    out.push({ kind: "decision", id: r.id, date: isoToDate(r.created_at), text: parts });
  }
  for (const r of (chkRes.data ?? []) as Array<{ id: string; log_date: string; energy: number | null; mood: number | null; focus: number | null; note: string | null }>) {
    if (!r.note || r.note.trim().length < 12) continue;
    out.push({ kind: "daily_checkin", id: r.id, date: r.log_date, text: `e${r.energy ?? "?"}/m${r.mood ?? "?"}/f${r.focus ?? "?"} — ${r.note.replace(/\s+/g, " ")}` });
  }
  return out;
}

async function loadSingleEntry(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  userId: string,
  kind: string,
  id: string,
): Promise<Entry | null> {
  if (kind === "reflection") {
    const { data } = await supabase
      .from("reflections")
      .select("id, text, kind, created_at")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    if (!data || !data.text) return null;
    return { kind: "reflection", id: data.id, date: isoToDate(data.created_at), text: `[${data.kind ?? "reflection"}] ${data.text.replace(/\s+/g, " ")}` };
  }
  if (kind === "decision") {
    const { data } = await supabase
      .from("decisions")
      .select("id, title, choice, expected_outcome, context, created_at")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const parts = [data.title, data.choice && `chose: ${data.choice}`, data.context && `context: ${data.context}`, data.expected_outcome && `expected: ${data.expected_outcome}`].filter(Boolean).join(" — ");
    return { kind: "decision", id: data.id, date: isoToDate(data.created_at), text: parts };
  }
  if (kind === "daily_checkin") {
    const { data } = await supabase
      .from("daily_checkins")
      .select("id, log_date, energy, mood, focus, note")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    if (!data || !data.note) return null;
    return { kind: "daily_checkin", id: data.id, date: data.log_date, text: `e${data.energy ?? "?"}/m${data.mood ?? "?"}/f${data.focus ?? "?"} — ${data.note.replace(/\s+/g, " ")}` };
  }
  return null;
}

function buildSystemPrompt(maxTotal: number, mode: "bulk" | "single"): string {
  const base = [
    "You are scanning the user's own writing for conceptual echoes — moments where the SAME emotional pattern, recurring frustration, stuck loop, insight, or theme reappears in different words.",
    "",
    `Output strict JSON: { "echoes": [...] } with up to ${maxTotal} entries. No prose outside the JSON.`,
    "",
    "Each echo has fields:",
    "- source_kind: one of reflection | decision | daily_checkin",
    "- source_id: the uuid of the recent entry (e.g. for 'reflection#abc' return JUST 'abc')",
    "- match_kind: one of reflection | decision | daily_checkin",
    "- match_id: the uuid of the older entry",
    "- similarity: 1-5 (1 = loose thematic overlap, 5 = nearly the same thought said again)",
    "- similarity_note: 1-2 sentences naming SPECIFICALLY what makes them echo. Quote a phrase from each side. Second person ('you …'). British English. No em-dashes. No moralising.",
    "",
    "What counts as an echo:",
    "- Same emotional pattern (you keep writing variations of 'I feel scattered when I have too many open loops')",
    "- Same stuck question (you keep returning to 'should I focus on X or Y')",
    "- Same insight phrased differently months apart",
    "- A decision now that mirrors a decision then in shape (same trade-off, same hesitation)",
    "- A check-in note that reads like another check-in note from before",
    "",
    "What does NOT count:",
    "- Generic same-topic ('both about work') — needs SAME pattern, not same topic",
    "- Same words but opposite meaning",
    "- Surface keyword overlap with no shared underlying state",
    "",
    "Rules:",
    "- Each echo MUST cite (source_kind, source_id) from the SOURCE DUMP and (match_kind, match_id) from the MATCH DUMP. Never invent ids.",
    "- The MATCH must be older than the SOURCE.",
    "- Don't echo a source to itself; don't echo the same pair twice.",
    "- If you can only honestly find a few echoes, output a few. Quality over quota.",
    "- If nothing is clearly worth surfacing, return { \"echoes\": [] }.",
  ];
  if (mode === "bulk") {
    base.push(
      "",
      "Vary across sources — if the user has 10 source entries, try to surface echoes for several of them, not all 5 echoes for one entry.",
    );
  }
  return base.join("\n");
}

function dumpEntries(entries: Entry[], cap: number): string {
  return entries
    .slice(0, cap)
    .map((e) => `${e.kind}#${e.id} (${e.date}): ${e.text.slice(0, 280)}`)
    .join("\n");
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    since_days?: number;
    max_per_source?: number;
    lookback_days?: number;
    source_kind?: string;
    source_id?: string;
    max?: number;
  } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const isSingle = typeof body.source_kind === "string" && typeof body.source_id === "string";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  const anthropic = new Anthropic({ apiKey });

  const now = new Date();
  const lookbackDays = Math.max(60, Math.min(1095, body.lookback_days ?? 365));
  const lookbackStart = new Date(now.getTime() - lookbackDays * 86_400_000).toISOString();

  let sources: Entry[] = [];
  let candidates: Entry[] = [];
  let maxTotal = 8;
  let bufferDays = 7;

  if (isSingle) {
    if (!VALID_KINDS.has(body.source_kind as string)) {
      return NextResponse.json({ error: "invalid source_kind" }, { status: 400 });
    }
    const single = await loadSingleEntry(supabase, user.id, body.source_kind as string, body.source_id as string);
    if (!single) return NextResponse.json({ error: "source entry not found" }, { status: 404 });
    sources = [single];
    maxTotal = Math.max(1, Math.min(10, body.max ?? 5));
    bufferDays = 7;
    const sourceDate = new Date(`${single.date}T23:59:59Z`);
    const matchEnd = new Date(sourceDate.getTime() - bufferDays * 86_400_000).toISOString();
    candidates = await loadEntriesIn(supabase, user.id, lookbackStart, matchEnd, {
      reflections: 200,
      decisions: 100,
      checkins: 200,
    });
  } else {
    const sinceDays = Math.max(1, Math.min(60, body.since_days ?? 14));
    const sourceStart = new Date(now.getTime() - sinceDays * 86_400_000).toISOString();
    const matchEnd = new Date(now.getTime() - (sinceDays + bufferDays) * 86_400_000).toISOString();
    sources = await loadEntriesIn(supabase, user.id, sourceStart, now.toISOString(), {
      reflections: 60,
      decisions: 30,
      checkins: 60,
    });
    candidates = await loadEntriesIn(supabase, user.id, lookbackStart, matchEnd, {
      reflections: 200,
      decisions: 100,
      checkins: 200,
    });
    const maxPerSource = Math.max(1, Math.min(5, body.max_per_source ?? 3));
    maxTotal = Math.max(1, Math.min(30, sources.length * maxPerSource));
  }

  if (sources.length === 0) {
    return NextResponse.json({ generated: [], note: "no recent narrative entries to echo against" });
  }
  if (candidates.length < 3) {
    return NextResponse.json({ generated: [], note: "not enough older entries in your history yet — keep writing and try again later" });
  }

  const sourceDump = dumpEntries(sources, 60);
  const candidateDump = dumpEntries(candidates, 220);

  const system = buildSystemPrompt(maxTotal, isSingle ? "single" : "bulk");
  const userMsg = `SOURCE DUMP (${sources.length} entries, the recent ones to find echoes FOR):\n${sourceDump}\n\nMATCH DUMP (${candidates.length} entries, older history to draw echoes FROM):\n${candidateDump}`;

  let raw = "";
  let model = MODEL;
  let switched = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await anthropic.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: "user", content: userMsg }],
      });
      const block = res.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") throw new Error("no text block");
      raw = block.text.trim();
      break;
    } catch (e) {
      if (!switched && isOverloaded(e)) { switched = true; model = FALLBACK_MODEL; continue; }
      return NextResponse.json({ error: e instanceof Error ? e.message : "haiku failed" }, { status: 502 });
    }
  }

  let parsed: { echoes?: unknown };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  const sourceById = new Map<string, Entry>(sources.map((e) => [`${e.kind}#${e.id}`, e]));
  const matchById = new Map<string, Entry>(candidates.map((e) => [`${e.kind}#${e.id}`, e]));

  const proposed: ProposedEcho[] = [];
  if (Array.isArray(parsed.echoes)) {
    for (const item of parsed.echoes) {
      if (typeof item !== "object" || !item) continue;
      const e = item as Record<string, unknown>;
      const sKind = typeof e.source_kind === "string" ? e.source_kind.trim() : "";
      const sId = typeof e.source_id === "string" ? e.source_id.replace(/^[a-z_]+#/, "").trim() : "";
      const mKind = typeof e.match_kind === "string" ? e.match_kind.trim() : "";
      const mId = typeof e.match_id === "string" ? e.match_id.replace(/^[a-z_]+#/, "").trim() : "";
      if (!VALID_KINDS.has(sKind) || !VALID_KINDS.has(mKind)) continue;
      const srcKey = `${sKind}#${sId}`;
      const matchKey = `${mKind}#${mId}`;
      if (!sourceById.has(srcKey)) continue;
      if (!matchById.has(matchKey)) continue;
      if (srcKey === matchKey) continue;
      const sim = typeof e.similarity === "number" ? Math.max(1, Math.min(5, Math.round(e.similarity))) : 3;
      const note = typeof e.similarity_note === "string" ? e.similarity_note.trim() : "";
      if (note.length < 8) continue;
      proposed.push({
        source_kind: sKind,
        source_id: sId,
        match_kind: mKind,
        match_id: mId,
        similarity: sim,
        similarity_note: note.slice(0, 600),
      });
      if (proposed.length >= maxTotal) break;
    }
  }

  if (proposed.length === 0) {
    return NextResponse.json({ generated: [], note: "model returned no grounded echoes" });
  }

  // Dedupe against existing (user, source, match) rows.
  const sourceIds = Array.from(new Set(proposed.map((p) => p.source_id)));
  const { data: existing } = await supabase
    .from("echoes")
    .select("source_kind, source_id, match_kind, match_id")
    .eq("user_id", user.id)
    .in("source_id", sourceIds);
  const existingKey = new Set<string>(
    (existing ?? []).map(
      (r: { source_kind: string; source_id: string; match_kind: string; match_id: string }) =>
        `${r.source_kind}|${r.source_id}|${r.match_kind}|${r.match_id}`,
    ),
  );
  const fresh = proposed.filter(
    (p) => !existingKey.has(`${p.source_kind}|${p.source_id}|${p.match_kind}|${p.match_id}`),
  );
  if (fresh.length === 0) {
    return NextResponse.json({
      generated: [],
      skipped_existing: proposed.length,
      note: "all detected echoes already exist",
    });
  }

  const inserts = fresh.map((p) => {
    const src = sourceById.get(`${p.source_kind}#${p.source_id}`)!;
    const m = matchById.get(`${p.match_kind}#${p.match_id}`)!;
    return {
      user_id: user.id,
      source_kind: p.source_kind,
      source_id: p.source_id,
      source_text_excerpt: src.text.slice(0, 500),
      source_date: src.date,
      match_kind: p.match_kind,
      match_id: p.match_id,
      match_text_excerpt: m.text.slice(0, 500),
      match_date: m.date,
      similarity: p.similarity,
      similarity_note: p.similarity_note,
    };
  });

  const { data: inserted, error: iErr } = await supabase
    .from("echoes")
    .insert(inserts)
    .select(
      "id, source_kind, source_id, source_text_excerpt, source_date, match_kind, match_id, match_text_excerpt, match_date, similarity, similarity_note, user_note, dismissed_at, created_at",
    );
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  return NextResponse.json({
    generated: inserted ?? [],
    skipped_existing: proposed.length - fresh.length,
  });
}
