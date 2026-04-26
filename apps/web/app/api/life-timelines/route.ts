// POST /api/life-timelines — stitch a fresh life-timeline. Pulls
// reflections / decisions / wins / standups (today field only) /
// themes within the window, dumps them as a chronological evidence
// stream, and asks Haiku to GROUP the stream into 3-7 chapters with
// titles, narrative paragraphs, date ranges, key decision/win ids,
// and active themes. Server validates that every cited decision/win
// id appears in the dump (no fabrication), drops chapters with bad
// dates or unbounded ranges, sorts by ordinal/start_date, and writes
// the new row with parent_id pointing at the previous active timeline
// for drift comparison.
//
// GET /api/life-timelines — list timelines.
//   ?status=active|pinned|archived|all (default active)
//   ?limit=N (default 10, max 40)

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 4000;

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function dateOnly(iso: string): string { return iso.slice(0, 10); }
function isValidDateString(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { window_days?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const windowDaysRaw = typeof body.window_days === "number" ? body.window_days : 1095;
  const windowDays = Math.max(90, Math.min(3650, Math.round(windowDaysRaw)));

  const t0 = Date.now();
  const sinceDate = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const sinceIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  const [refRes, decRes, winRes, stdRes, themesRes] = await Promise.all([
    supabase.from("reflections").select("id, text, kind, created_at").eq("user_id", user.id).gte("created_at", sinceIso).order("created_at", { ascending: true }).limit(120),
    supabase.from("decisions").select("id, title, choice, expected_outcome, tags, created_at").eq("user_id", user.id).gte("created_at", sinceIso).order("created_at", { ascending: true }).limit(60),
    supabase.from("wins").select("id, text, kind, created_at").eq("user_id", user.id).gte("created_at", sinceIso).order("created_at", { ascending: true }).limit(80),
    supabase.from("standups").select("today, log_date").eq("user_id", user.id).gte("log_date", sinceDate).order("log_date", { ascending: true }).limit(80),
    supabase.from("themes").select("title, current_state, status, created_at, updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(20),
  ]);

  const refs = (refRes.data ?? []) as Array<{ id: string; text: string; kind: string; created_at: string }>;
  const decs = (decRes.data ?? []) as Array<{ id: string; title: string; choice: string | null; expected_outcome: string | null; tags: string[] | null; created_at: string }>;
  const wins = (winRes.data ?? []) as Array<{ id: string; text: string; kind: string | null; created_at: string }>;
  const stds = (stdRes.data ?? []) as Array<{ today: string | null; log_date: string }>;
  const themes = (themesRes.data ?? []) as Array<{ title: string; current_state: string | null; status: string; created_at: string; updated_at: string }>;

  const totalEvidence = refs.length + decs.length + wins.length + stds.filter((s) => s.today).length + themes.length;
  if (totalEvidence < 8) {
    return NextResponse.json({ error: "not enough writing yet to stitch a timeline — need at least 8 reflections / decisions / wins / themes combined in the window" }, { status: 400 });
  }

  // Build CHRONOLOGICAL evidence stream
  const evidenceLines: string[] = [];
  evidenceLines.push(`WINDOW: ${sinceDate} to ${new Date().toISOString().slice(0, 10)} (${windowDays} days)`);
  evidenceLines.push("");

  const decIdSet = new Set(decs.map((d) => d.id));
  const winIdSet = new Set(wins.map((w) => w.id));

  type StreamItem = { date: string; line: string };
  const stream: StreamItem[] = [];

  for (const r of refs) {
    stream.push({ date: dateOnly(r.created_at), line: `${dateOnly(r.created_at)} REFLECT [${r.kind}]: ${r.text.slice(0, 220)}` });
  }
  for (const d of decs) {
    const tagPart = d.tags && d.tags.length ? ` [tags: ${d.tags.slice(0, 4).join(", ")}]` : "";
    stream.push({ date: dateOnly(d.created_at), line: `${dateOnly(d.created_at)} DECIDE id=${d.id}: ${d.title}${d.choice ? " — " + d.choice.slice(0, 140) : ""}${tagPart}` });
  }
  for (const w of wins) {
    stream.push({ date: dateOnly(w.created_at), line: `${dateOnly(w.created_at)} WIN id=${w.id} [${w.kind ?? "win"}]: ${w.text.slice(0, 180)}` });
  }
  for (const s of stds) {
    if (s.today) stream.push({ date: s.log_date, line: `${s.log_date} STANDUP-TODAY: ${s.today.slice(0, 200)}` });
  }
  stream.sort((a, b) => a.date.localeCompare(b.date));

  evidenceLines.push("CHRONOLOGICAL STREAM (oldest first):");
  for (const item of stream) evidenceLines.push(item.line);
  evidenceLines.push("");

  if (themes.length) {
    evidenceLines.push("THEMES (life-arcs, ordered by updated_at desc):");
    for (const t of themes) {
      evidenceLines.push(`- "${t.title}" [${t.status}] ${t.current_state ? `— ${t.current_state.slice(0, 140)}` : ""}`);
    }
    evidenceLines.push("");
  }

  const earliestDate = stream.length > 0 && stream[0] ? stream[0].date : sinceDate;
  const latestDate = stream.length > 0 && stream[stream.length - 1] ? (stream[stream.length - 1] as StreamItem).date : new Date().toISOString().slice(0, 10);

  // Pull previous active timeline for drift comparison
  const { data: prev } = await supabase
    .from("life_timelines")
    .select("id, chapters, created_at")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevSection: string[] = [];
  if (prev) {
    const p = prev as { id: string; chapters: Array<{ ordinal?: number; title?: string; start_date?: string; end_date?: string }>; created_at: string };
    prevSection.push(`PREVIOUS TIMELINE (stitched ${dateOnly(p.created_at)}):`);
    const sortedPrev = [...(p.chapters ?? [])].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
    for (const c of sortedPrev) {
      prevSection.push(`- "${c.title ?? "?"}" (${c.start_date ?? "?"} → ${c.end_date ?? "current"})`);
    }
    prevSection.push("");
  }

  const system = [
    "You are STITCHING the user's life-timeline from a chronological stream of their reflections, decisions, wins, and standup-today entries.",
    "",
    "Group the stream into 3-7 CHAPTERS — natural eras where themes hold steady, then a pivot or major decision marks a transition. Don't split arbitrarily by date. Don't lump everything into one chapter. Find the SHAPE of the story.",
    "",
    "Output strict JSON ONLY:",
    `{"chapters": [{"ordinal": 1, "title": "...", "narrative": "...", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" | null, "themes": ["..."], "key_decision_ids": ["..."], "key_win_ids": ["..."]}, ...], "drift_summary": "..." | null}`,
    "",
    "Chapter rules:",
    "- ordinal: 1, 2, 3 ... in chronological order.",
    "- title: 3-6 WORDS, sharp and characterful (e.g. 'The First JARVIS Pivot', 'Quiet Year Of Building', 'The Partnership Trap', 'Finding The Voice'). NOT generic ('A Time Of Growth'). Mirror the user's specific work and language.",
    "- narrative: 3-4 sentences, second person ('you started X', 'you decided Y'), naming the actual decisions + tensions + wins of that era. Don't summarise the journal — characterise the era.",
    "- start_date / end_date: YYYY-MM-DD bounding the chapter. end_date can be null for the current chapter only.",
    "- themes: 1-3 theme TITLES (exact strings) most active in the chapter. Pull from the THEMES list — don't invent.",
    "- key_decision_ids: 1-3 decision UUIDs (exact, from the DECIDE id=... lines). Empty array if none defining.",
    "- key_win_ids: 1-3 win UUIDs (exact, from the WIN id=... lines). Empty array if none defining.",
    "- Chapters must be CONTIGUOUS — no gaps, no overlaps. Each chapter ends the day before the next begins.",
    "- Don't end every chapter on a 'breakthrough'. Some eras are just slow grinds; say so.",
    "",
    "Drift_summary rules:",
    "- ONLY include if a previous timeline exists (shown below). Otherwise return null.",
    "- ONE sentence, 12-30 words, second person, naming what RE-CONFIGURED between the two stitchings (e.g. 'the 2025 partnership era is now retroactively split into a hopeful first half and a grinding second half', 'the early-JARVIS chapter stretched longer than the previous timeline credited').",
    "- If chapters are essentially unchanged: 'the timeline is largely the same, with X chapter extended by N weeks of additional writing'.",
    "",
    "Voice rules:",
    "- British English. No em-dashes. No emoji. No clichés. No moralising.",
    "- Don't hedge ('it seems that...'). State the era's shape with confidence.",
    "- Don't fabricate decisions or wins not in the dump.",
    prev ? "\n" + prevSection.join("\n") : "",
  ].filter(Boolean).join("\n");

  const userMsg = ["EVIDENCE:", "", evidenceLines.join("\n")].join("\n");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  const anthropic = new Anthropic({ apiKey });

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

  let parsed: { chapters?: unknown[]; drift_summary?: unknown };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.chapters) || parsed.chapters.length === 0) {
    return NextResponse.json({ error: "model returned no chapters" }, { status: 502 });
  }

  type ParsedChapter = {
    ordinal?: unknown;
    title?: unknown;
    narrative?: unknown;
    start_date?: unknown;
    end_date?: unknown;
    themes?: unknown;
    key_decision_ids?: unknown;
    key_win_ids?: unknown;
  };

  const themeTitles = new Set(themes.map((t) => t.title));
  const validChapters: Array<{
    ordinal: number;
    title: string;
    narrative: string;
    start_date: string;
    end_date: string | null;
    themes: string[];
    key_decision_ids: string[];
    key_win_ids: string[];
  }> = [];

  for (const c of parsed.chapters as ParsedChapter[]) {
    const ordinal = typeof c.ordinal === "number" ? Math.round(c.ordinal) : null;
    const title = typeof c.title === "string" ? c.title.trim().slice(0, 60) : "";
    const narrative = typeof c.narrative === "string" ? c.narrative.trim().slice(0, 1200) : "";
    if (!ordinal || !title || !narrative) continue;
    if (!isValidDateString(c.start_date)) continue;
    const start_date: string = c.start_date;
    let end_date: string | null;
    if (c.end_date == null) end_date = null;
    else if (isValidDateString(c.end_date)) end_date = c.end_date;
    else continue;
    if (end_date != null && end_date < start_date) continue;

    const themesArr = Array.isArray(c.themes)
      ? (c.themes.filter((t): t is string => typeof t === "string" && themeTitles.has(t)).slice(0, 3))
      : [];
    const decIds = Array.isArray(c.key_decision_ids)
      ? (c.key_decision_ids.filter((id): id is string => typeof id === "string" && decIdSet.has(id)).slice(0, 3))
      : [];
    const winIds = Array.isArray(c.key_win_ids)
      ? (c.key_win_ids.filter((id): id is string => typeof id === "string" && winIdSet.has(id)).slice(0, 3))
      : [];

    validChapters.push({
      ordinal,
      title,
      narrative,
      start_date,
      end_date,
      themes: themesArr,
      key_decision_ids: decIds,
      key_win_ids: winIds,
    });
  }

  if (validChapters.length === 0) {
    return NextResponse.json({ error: "no valid chapters after server-side validation" }, { status: 502 });
  }

  validChapters.sort((a, b) => a.ordinal - b.ordinal);
  // Re-ordinal to fill gaps from any dropped invalid chapters
  validChapters.forEach((c, i) => { c.ordinal = i + 1; });

  const driftSummary = prev && typeof parsed.drift_summary === "string"
    ? parsed.drift_summary.trim().slice(0, 400)
    : null;

  const counts = {
    reflections: refs.length,
    decisions: decs.length,
    wins: wins.length,
    standups: stds.filter((s) => s.today).length,
    themes: themes.length,
    chapters: validChapters.length,
  };
  const sourceSummary = `${validChapters.length} chapters across ${earliestDate} → ${latestDate} (${windowDays}d window) from ${totalEvidence} entries`;
  const latencyMs = Date.now() - t0;

  const { data: inserted, error } = await supabase
    .from("life_timelines")
    .insert({
      user_id: user.id,
      chapters: validChapters,
      drift_summary: driftSummary,
      source_summary: sourceSummary,
      source_counts: counts,
      earliest_date: earliestDate,
      latest_date: latestDate,
      parent_id: prev ? (prev as { id: string }).id : null,
      latency_ms: latencyMs,
      model,
    })
    .select("id, chapters, drift_summary, source_summary, source_counts, earliest_date, latest_date, parent_id, pinned, archived_at, user_note, latency_ms, model, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ timeline: inserted });
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "active";
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "10", 10);
  const limit = Math.max(1, Math.min(40, isNaN(limitRaw) ? 10 : limitRaw));

  let q = supabase
    .from("life_timelines")
    .select("id, chapters, drift_summary, source_summary, source_counts, earliest_date, latest_date, parent_id, pinned, archived_at, user_note, latency_ms, model, created_at")
    .eq("user_id", user.id);

  if (status === "active") q = q.is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);

  q = q.order("created_at", { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ timelines: data ?? [] });
}
