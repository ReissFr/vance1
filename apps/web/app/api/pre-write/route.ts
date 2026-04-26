// POST /api/pre-write — generate a draft for one of:
//   kind: "reflection" | "standup" | "intention" | "win" | "checkin"
//   subkind?: string  (e.g. reflection.kind = "lesson" | "regret" | …)
//
// Server pulls the kind-specific recent context (yesterday's standup,
// today's intentions, last 7d reflections, etc) plus the user's
// brand_voice samples for tone, then asks Haiku to draft what the user
// would plausibly write — in their own voice. Returns a pre_writes row.
//
// The draft is NOT saved as a real reflection/standup/etc. It's logged
// in pre_writes with status='shown'. The UI shows the draft in the form,
// the user edits, and on save the form's submit handler PATCHes the
// pre_write to mark accepted/edited and set accepted_id. If the user
// rejects, we mark rejected. This gives JARVIS feedback over time on
// which kinds it predicts well.
//
// GET /api/pre-write — list recent pre_writes for the dashboard.
//   ?status=shown|accepted|edited|rejected|all (default all)
//   ?kind=reflection|...|all (default all)
//   ?limit=N (default 30, max 100)

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 1200;

const VALID_KINDS = ["reflection", "standup", "intention", "win", "checkin"] as const;
type Kind = (typeof VALID_KINDS)[number];

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoToDate(iso: string): string { return iso.slice(0, 10); }

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { kind?: string; subkind?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  if (typeof body.kind !== "string" || !VALID_KINDS.includes(body.kind as Kind)) {
    return NextResponse.json({ error: "kind required: reflection|standup|intention|win|checkin" }, { status: 400 });
  }
  const kind = body.kind as Kind;
  const subkind = typeof body.subkind === "string" ? body.subkind.trim().slice(0, 32) : null;

  const t0 = Date.now();

  const since7Iso = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const since3DaysDate = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const today = todayDate();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  const evidenceLines: string[] = [];
  const counts: Record<string, number> = {};

  if (kind === "reflection") {
    const [stdRes, decRes, chkRes, intRes, refRes, themesRes] = await Promise.all([
      supabase.from("standups").select("log_date, yesterday, today, blockers").eq("user_id", user.id).gte("log_date", since3DaysDate).order("log_date", { ascending: false }).limit(5),
      supabase.from("decisions").select("title, choice, expected_outcome, created_at").eq("user_id", user.id).gte("created_at", since7Iso).order("created_at", { ascending: false }).limit(5),
      supabase.from("daily_checkins").select("log_date, energy, mood, focus, note").eq("user_id", user.id).gte("log_date", since3DaysDate).order("log_date", { ascending: false }).limit(5),
      supabase.from("intentions").select("text, log_date, completed_at").eq("user_id", user.id).gte("log_date", since3DaysDate).order("log_date", { ascending: false }).limit(8),
      supabase.from("reflections").select("text, kind, created_at").eq("user_id", user.id).gte("created_at", since7Iso).order("created_at", { ascending: false }).limit(8),
      supabase.from("themes").select("title, current_state").eq("user_id", user.id).eq("status", "active").order("updated_at", { ascending: false }).limit(5),
    ]);
    const stds = (stdRes.data ?? []) as Array<{ log_date: string; yesterday: string | null; today: string | null; blockers: string | null }>;
    const decs = (decRes.data ?? []) as Array<{ title: string; choice: string | null; expected_outcome: string | null; created_at: string }>;
    const chks = (chkRes.data ?? []) as Array<{ log_date: string; energy: number | null; mood: number | null; focus: number | null; note: string | null }>;
    const ints = (intRes.data ?? []) as Array<{ text: string; log_date: string; completed_at: string | null }>;
    const refs = (refRes.data ?? []) as Array<{ text: string; kind: string; created_at: string }>;
    const themes = (themesRes.data ?? []) as Array<{ title: string; current_state: string | null }>;
    counts.standups = stds.length; counts.decisions = decs.length; counts.checkins = chks.length; counts.intentions = ints.length; counts.recent_reflections = refs.length; counts.themes = themes.length;

    if (stds.length) { evidenceLines.push("Recent standups:"); for (const s of stds) { const parts = [s.yesterday && `y: ${s.yesterday}`, s.today && `t: ${s.today}`, s.blockers && `b: ${s.blockers}`].filter(Boolean).join(" | "); if (parts) evidenceLines.push(`- (${s.log_date}) ${parts.slice(0, 240)}`); } evidenceLines.push(""); }
    if (decs.length) { evidenceLines.push("Recent decisions:"); for (const d of decs) evidenceLines.push(`- (${isoToDate(d.created_at)}) ${d.title}${d.choice ? ` — ${d.choice}` : ""}`); evidenceLines.push(""); }
    if (chks.length) { evidenceLines.push("Recent check-ins:"); for (const c of chks) evidenceLines.push(`- (${c.log_date}) e${c.energy ?? "?"}/m${c.mood ?? "?"}/f${c.focus ?? "?"}${c.note ? " — " + c.note.slice(0, 160) : ""}`); evidenceLines.push(""); }
    if (ints.length) { evidenceLines.push("Recent intentions:"); for (const i of ints) evidenceLines.push(`- (${i.log_date}${i.completed_at ? ", ✓" : ""}) ${i.text.slice(0, 160)}`); evidenceLines.push(""); }
    if (themes.length) { evidenceLines.push("Active themes:"); for (const t of themes) evidenceLines.push(`- ${t.title}${t.current_state ? ` — ${t.current_state.slice(0, 140)}` : ""}`); evidenceLines.push(""); }
    if (refs.length) { evidenceLines.push("Recent reflections (avoid duplicating these):"); for (const r of refs) evidenceLines.push(`- [${r.kind}] ${r.text.slice(0, 180)}`); evidenceLines.push(""); }
  } else if (kind === "standup") {
    const [yestStandup, todayInts, openCommitments, recentDecs, openBlockers] = await Promise.all([
      supabase.from("standups").select("yesterday, today, blockers").eq("user_id", user.id).eq("log_date", yesterday).maybeSingle(),
      supabase.from("intentions").select("text, completed_at").eq("user_id", user.id).eq("log_date", today).order("created_at", { ascending: true }).limit(8),
      supabase.from("commitments").select("text, due_at, status").eq("user_id", user.id).eq("status", "open").order("due_at", { ascending: true, nullsFirst: false }).limit(8),
      supabase.from("decisions").select("title, choice, created_at").eq("user_id", user.id).gte("created_at", new Date(Date.now() - 2 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(5),
      supabase.from("standups").select("blockers").eq("user_id", user.id).gte("log_date", since3DaysDate).order("log_date", { ascending: false }).limit(3),
    ]);
    const ystd = yestStandup.data as { yesterday: string | null; today: string | null; blockers: string | null } | null;
    const ints = (todayInts.data ?? []) as Array<{ text: string; completed_at: string | null }>;
    const coms = (openCommitments.data ?? []) as Array<{ text: string; due_at: string | null; status: string }>;
    const decs = (recentDecs.data ?? []) as Array<{ title: string; choice: string | null; created_at: string }>;
    const blocks = (openBlockers.data ?? []) as Array<{ blockers: string | null }>;
    counts.yesterday_standup = ystd ? 1 : 0; counts.today_intentions = ints.length; counts.open_commitments = coms.length; counts.recent_decisions = decs.length;

    if (ystd) {
      evidenceLines.push("Yesterday's standup:");
      if (ystd.yesterday) evidenceLines.push(`- yesterday: ${ystd.yesterday}`);
      if (ystd.today) evidenceLines.push(`- today (yesterday's plan): ${ystd.today}`);
      if (ystd.blockers) evidenceLines.push(`- blockers: ${ystd.blockers}`);
      evidenceLines.push("");
    } else {
      evidenceLines.push("No standup yesterday — draft from intentions and commitments.");
      evidenceLines.push("");
    }
    if (ints.length) { evidenceLines.push("Today's intentions already logged:"); for (const i of ints) evidenceLines.push(`- ${i.completed_at ? "✓" : "○"} ${i.text.slice(0, 180)}`); evidenceLines.push(""); }
    if (coms.length) { evidenceLines.push("Open commitments:"); for (const c of coms) evidenceLines.push(`- ${c.text.slice(0, 180)}${c.due_at ? ` (due ${c.due_at.slice(0, 10)})` : ""}`); evidenceLines.push(""); }
    if (decs.length) { evidenceLines.push("Decisions in last 48h:"); for (const d of decs) evidenceLines.push(`- ${d.title}${d.choice ? ` — ${d.choice}` : ""}`); evidenceLines.push(""); }
    const recentBlockers = blocks.map((b) => b.blockers).filter((x): x is string => !!x && x.trim().length > 0);
    if (recentBlockers.length) { evidenceLines.push("Recent blockers (still relevant?):"); for (const b of recentBlockers) evidenceLines.push(`- ${b.slice(0, 200)}`); evidenceLines.push(""); }
  } else if (kind === "intention") {
    const [yestStandup, yestInts, themesRes, recentChk] = await Promise.all([
      supabase.from("standups").select("today, blockers").eq("user_id", user.id).eq("log_date", yesterday).maybeSingle(),
      supabase.from("intentions").select("text, completed_at").eq("user_id", user.id).eq("log_date", yesterday).order("created_at", { ascending: true }).limit(5),
      supabase.from("themes").select("title, current_state").eq("user_id", user.id).eq("status", "active").order("updated_at", { ascending: false }).limit(4),
      supabase.from("daily_checkins").select("log_date, energy, mood, focus, note").eq("user_id", user.id).gte("log_date", since3DaysDate).order("log_date", { ascending: false }).limit(2),
    ]);
    const ystd = yestStandup.data as { today: string | null; blockers: string | null } | null;
    const yints = (yestInts.data ?? []) as Array<{ text: string; completed_at: string | null }>;
    const themes = (themesRes.data ?? []) as Array<{ title: string; current_state: string | null }>;
    const chks = (recentChk.data ?? []) as Array<{ log_date: string; energy: number | null; mood: number | null; focus: number | null; note: string | null }>;
    counts.yesterday_intentions = yints.length; counts.themes = themes.length; counts.checkins = chks.length;

    if (ystd?.today) { evidenceLines.push(`Yesterday's standup said today's plan: ${ystd.today}`); evidenceLines.push(""); }
    if (yints.length) { evidenceLines.push("Yesterday's intentions:"); for (const i of yints) evidenceLines.push(`- ${i.completed_at ? "✓" : "○ uncompleted"} ${i.text.slice(0, 180)}`); evidenceLines.push(""); }
    if (themes.length) { evidenceLines.push("Active themes:"); for (const t of themes) evidenceLines.push(`- ${t.title}${t.current_state ? ` — ${t.current_state.slice(0, 140)}` : ""}`); evidenceLines.push(""); }
    if (chks.length) { evidenceLines.push("Recent check-ins:"); for (const c of chks) evidenceLines.push(`- (${c.log_date}) e${c.energy ?? "?"}/m${c.mood ?? "?"}/f${c.focus ?? "?"}${c.note ? " — " + c.note.slice(0, 160) : ""}`); evidenceLines.push(""); }
  } else if (kind === "win") {
    const [todayStandup, todayInts, recentWins, recentDecs] = await Promise.all([
      supabase.from("standups").select("yesterday, today, blockers").eq("user_id", user.id).eq("log_date", today).maybeSingle(),
      supabase.from("intentions").select("text, completed_at").eq("user_id", user.id).eq("log_date", today).limit(8),
      supabase.from("wins").select("text, kind, created_at").eq("user_id", user.id).gte("created_at", new Date(Date.now() - 2 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(5),
      supabase.from("decisions").select("title, choice, created_at").eq("user_id", user.id).gte("created_at", new Date(Date.now() - 2 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(3),
    ]);
    const tstd = todayStandup.data as { yesterday: string | null; today: string | null; blockers: string | null } | null;
    const tints = (todayInts.data ?? []) as Array<{ text: string; completed_at: string | null }>;
    const wins = (recentWins.data ?? []) as Array<{ text: string; kind: string | null; created_at: string }>;
    const decs = (recentDecs.data ?? []) as Array<{ title: string; choice: string | null; created_at: string }>;
    counts.today_standup = tstd ? 1 : 0; counts.completed_intentions = tints.filter((i) => i.completed_at).length; counts.recent_wins = wins.length; counts.recent_decisions = decs.length;

    if (tstd) { evidenceLines.push("Today's standup:"); if (tstd.yesterday) evidenceLines.push(`- yesterday: ${tstd.yesterday}`); if (tstd.today) evidenceLines.push(`- today: ${tstd.today}`); evidenceLines.push(""); }
    const completed = tints.filter((i) => i.completed_at);
    if (completed.length) { evidenceLines.push("Today's completed intentions:"); for (const i of completed) evidenceLines.push(`- ✓ ${i.text.slice(0, 180)}`); evidenceLines.push(""); }
    if (decs.length) { evidenceLines.push("Recent decisions (might be a win):"); for (const d of decs) evidenceLines.push(`- ${d.title}${d.choice ? ` — ${d.choice}` : ""}`); evidenceLines.push(""); }
    if (wins.length) { evidenceLines.push("Recent wins (avoid duplicating):"); for (const w of wins) evidenceLines.push(`- [${w.kind ?? "win"}] ${w.text.slice(0, 180)}`); evidenceLines.push(""); }
  } else if (kind === "checkin") {
    const [recentChk, todayInts, todayStandup] = await Promise.all([
      supabase.from("daily_checkins").select("log_date, energy, mood, focus, note").eq("user_id", user.id).gte("log_date", since3DaysDate).order("log_date", { ascending: false }).limit(5),
      supabase.from("intentions").select("text, completed_at").eq("user_id", user.id).eq("log_date", today).limit(6),
      supabase.from("standups").select("today, blockers").eq("user_id", user.id).eq("log_date", today).maybeSingle(),
    ]);
    const chks = (recentChk.data ?? []) as Array<{ log_date: string; energy: number | null; mood: number | null; focus: number | null; note: string | null }>;
    const tints = (todayInts.data ?? []) as Array<{ text: string; completed_at: string | null }>;
    const tstd = todayStandup.data as { today: string | null; blockers: string | null } | null;
    counts.checkins = chks.length; counts.today_intentions = tints.length;

    if (chks.length) { evidenceLines.push("Recent check-ins:"); for (const c of chks) evidenceLines.push(`- (${c.log_date}) e${c.energy ?? "?"}/m${c.mood ?? "?"}/f${c.focus ?? "?"}${c.note ? " — " + c.note.slice(0, 160) : ""}`); evidenceLines.push(""); }
    if (tstd?.today) { evidenceLines.push(`Today's plan: ${tstd.today}`); evidenceLines.push(""); }
    if (tints.length) { evidenceLines.push("Today's intentions:"); for (const i of tints) evidenceLines.push(`- ${i.completed_at ? "✓" : "○"} ${i.text.slice(0, 160)}`); evidenceLines.push(""); }
  }

  const totalEvidence = Object.values(counts).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
  if (totalEvidence === 0) {
    return NextResponse.json({ error: "not enough recent context to draft yet — log a standup or check-in first" }, { status: 400 });
  }

  // Brand voice for tone matching
  const { data: voice } = await supabase
    .from("brand_voice")
    .select("tone_keywords, avoid_words, voice_notes, sample_message, sample_post")
    .eq("user_id", user.id)
    .maybeSingle();
  const voiceLines: string[] = [];
  if (voice) {
    const v = voice as { tone_keywords: string[] | null; avoid_words: string[] | null; voice_notes: string | null; sample_message: string | null; sample_post: string | null };
    if (v.tone_keywords && v.tone_keywords.length) voiceLines.push(`Tone: ${v.tone_keywords.join(", ")}`);
    if (v.avoid_words && v.avoid_words.length) voiceLines.push(`Avoid: ${v.avoid_words.join(", ")}`);
    if (v.voice_notes) voiceLines.push(`Voice notes: ${v.voice_notes.slice(0, 320)}`);
    if (v.sample_message) voiceLines.push(`Sample of how the user writes:\n${v.sample_message.slice(0, 600)}`);
  }

  // Pull a few recent of the SAME kind to mimic phrasing
  const sampleLines: string[] = [];
  if (kind === "reflection") {
    const { data: samples } = await supabase.from("reflections").select("text, kind").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5);
    const arr = (samples ?? []) as Array<{ text: string; kind: string }>;
    for (const s of arr) sampleLines.push(`[${s.kind}] ${s.text.slice(0, 220)}`);
  } else if (kind === "standup") {
    const { data: samples } = await supabase.from("standups").select("yesterday, today, blockers, log_date").eq("user_id", user.id).order("log_date", { ascending: false }).limit(3);
    const arr = (samples ?? []) as Array<{ yesterday: string | null; today: string | null; blockers: string | null; log_date: string }>;
    for (const s of arr) sampleLines.push(`(${s.log_date}) y: ${s.yesterday ?? ""}\nt: ${s.today ?? ""}\nb: ${s.blockers ?? ""}`);
  } else if (kind === "intention") {
    const { data: samples } = await supabase.from("intentions").select("text, log_date").eq("user_id", user.id).order("log_date", { ascending: false }).limit(8);
    const arr = (samples ?? []) as Array<{ text: string; log_date: string }>;
    for (const s of arr) sampleLines.push(s.text.slice(0, 200));
  } else if (kind === "win") {
    const { data: samples } = await supabase.from("wins").select("text, kind").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5);
    const arr = (samples ?? []) as Array<{ text: string; kind: string | null }>;
    for (const s of arr) sampleLines.push(`[${s.kind ?? "win"}] ${s.text.slice(0, 220)}`);
  } else if (kind === "checkin") {
    const { data: samples } = await supabase.from("daily_checkins").select("note, log_date, energy, mood, focus").eq("user_id", user.id).not("note", "is", null).order("log_date", { ascending: false }).limit(5);
    const arr = (samples ?? []) as Array<{ note: string | null; log_date: string; energy: number | null; mood: number | null; focus: number | null }>;
    for (const s of arr) if (s.note) sampleLines.push(`(${s.log_date}) e${s.energy ?? "?"}/m${s.mood ?? "?"}/f${s.focus ?? "?"} — ${s.note.slice(0, 200)}`);
  }

  const FIELDS_BY_KIND: Record<Kind, string[]> = {
    reflection: ["text", "kind"],
    standup: ["yesterday", "today", "blockers"],
    intention: ["text"],
    win: ["text", "kind"],
    checkin: ["energy", "mood", "focus", "note"],
  };

  const FIELD_RULES: Record<Kind, string> = {
    reflection: 'text: 1-3 sentences in the user\'s voice (NOT a summary of their writing — a fresh observation/lesson/realisation drawn from the evidence). kind: one of "lesson"|"regret"|"realisation"|"observation"|"gratitude"|"other".',
    standup: 'yesterday: bulleted-but-flat (use "·" separators or short sentences), 1-3 items, what actually happened yesterday. today: 1-3 items in the same shape, what to do. blockers: 0-1 short note (or empty string if none). Keep it telegraphic — no "I" subjects, no preamble.',
    intention: 'text: ONE sentence in the user\'s voice naming today\'s single most important focus. Concrete, action-shaped (verb-led). Don\'t hedge, don\'t list multiple things.',
    win: 'text: 1-2 sentences naming a specific shipped/completed thing or a real moment of progress (NOT a vague "good day"). kind: one of "ship"|"learning"|"connection"|"health"|"focus"|"other".',
    checkin: 'energy: 1-5 best estimate. mood: 1-5 best estimate. focus: 1-5 best estimate. note: 0-2 sentences capturing the felt-state — concrete, no clichés, no advice.',
  };

  const system = [
    `You are PRE-WRITING the user's next ${kind}${subkind ? ` (${subkind})` : ""}.`,
    "",
    `The user is about to open their ${kind} form. Your job is to draft what they would PLAUSIBLY write next, in their own voice, so they can edit instead of starting from blank. This is not a summary of their week. It is a fresh ${kind} entry that fits naturally with everything they've already written.`,
    "",
    "Output strict JSON with these fields ONLY:",
    `{ ${FIELDS_BY_KIND[kind].map((f) => `"${f}": ...`).join(", ")} }`,
    "",
    "Field rules:",
    FIELD_RULES[kind],
    "",
    "Voice rules:",
    "- Match the user's tone from the samples below. If they write in lowercase fragments, you write in lowercase fragments. If they use specific phrases, mirror them.",
    "- Don't ADVISE the user. Don't be a coach. Speak AS them.",
    "- British English. No em-dashes. No hashtags. No emoji unless the samples use them.",
    "- Don't fabricate facts not in the evidence. Stay grounded.",
    "- If a duplicate of recent entries: pick a slightly different angle so the user has something to edit, not paste.",
    voiceLines.length ? `\nUser's stated voice:\n${voiceLines.join("\n")}` : "",
    sampleLines.length ? `\nRECENT SAMPLES of the user's actual ${kind} entries (mirror this phrasing/cadence):\n${sampleLines.join("\n---\n")}` : "",
  ].filter(Boolean).join("\n");

  const userMsg = ["EVIDENCE FROM THE USER'S RECENT STATE:", "", evidenceLines.join("\n")].join("\n");

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

  let parsed: Record<string, unknown>;
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  // Per-kind validation + sanitisation
  const draft: Record<string, unknown> = {};
  for (const f of FIELDS_BY_KIND[kind]) {
    const v = parsed[f];
    if (kind === "checkin" && (f === "energy" || f === "mood" || f === "focus")) {
      const n = typeof v === "number" ? Math.round(v) : null;
      draft[f] = n != null ? Math.max(1, Math.min(5, n)) : null;
    } else if (typeof v === "string") {
      draft[f] = v.trim().slice(0, kind === "reflection" || kind === "win" ? 800 : 500);
    } else {
      draft[f] = null;
    }
  }

  // Mark previous shown drafts of same kind/subkind as superseded so the
  // dashboard doesn't pile up stale rows.
  const sameKindFilter = supabase
    .from("pre_writes")
    .update({ status: "superseded", resolved_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("kind", kind)
    .eq("status", "shown");
  if (subkind) await sameKindFilter.eq("subkind", subkind);
  else await sameKindFilter;

  const sourceSummary = `Drafted from ${Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(", ")}`;
  const latencyMs = Date.now() - t0;

  const { data: inserted, error } = await supabase
    .from("pre_writes")
    .insert({
      user_id: user.id,
      kind,
      subkind,
      draft_body: draft,
      source_summary: sourceSummary,
      source_counts: counts,
      latency_ms: latencyMs,
      model,
    })
    .select("id, kind, subkind, draft_body, source_summary, source_counts, status, latency_ms, model, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ pre_write: inserted });
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "all";
  const kind = url.searchParams.get("kind") ?? "all";
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.max(1, Math.min(100, isNaN(limitRaw) ? 30 : limitRaw));

  let q = supabase
    .from("pre_writes")
    .select("id, kind, subkind, draft_body, source_summary, source_counts, status, accepted_id, user_score, user_note, latency_ms, model, created_at, resolved_at")
    .eq("user_id", user.id);
  if (status !== "all") q = q.eq("status", status);
  if (kind !== "all") q = q.eq("kind", kind);
  q = q.order("created_at", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Array<{ status: string; kind: string }>;
  const acceptanceByKind: Record<string, { shown: number; accepted: number; edited: number; rejected: number }> = {};
  for (const r of rows) {
    const k = r.kind;
    if (!acceptanceByKind[k]) acceptanceByKind[k] = { shown: 0, accepted: 0, edited: 0, rejected: 0 };
    const bucket = acceptanceByKind[k];
    if (bucket) {
      if (r.status === "shown" || r.status === "superseded") bucket.shown++;
      else if (r.status === "accepted") bucket.accepted++;
      else if (r.status === "edited") bucket.edited++;
      else if (r.status === "rejected") bucket.rejected++;
    }
  }

  return NextResponse.json({ pre_writes: data ?? [], acceptance_by_kind: acceptanceByKind });
}
