// POST /api/self-mirrors — generate a new mirror snapshot.
//   body: { window_days?: number (3-90, default 7) }
//
// GET /api/self-mirrors — list mirrors (newest first).
//   ?status=active|pinned|archived|all (default active)
//   ?limit=N (default 30, max 100)
//
// The model is told to write a third-person *description*, not advice —
// who the user appears to be in this window, based on the cited evidence.
// Server validates that the body is non-empty after trimming and clamps
// the body length.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 1200;

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function clampWindow(raw: unknown): number {
  const n = typeof raw === "number" ? Math.round(raw) : 7;
  return Math.max(3, Math.min(90, n));
}

function isoToDate(iso: string): string {
  return iso.slice(0, 10);
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { window_days?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const windowDays = clampWindow(body.window_days);

  const now = new Date();
  const since = new Date(now.getTime() - windowDays * 86_400_000);
  const sinceIso = since.toISOString();
  const sinceDate = sinceIso.slice(0, 10);
  const nowDate = now.toISOString().slice(0, 10);

  // Pull a representative slice of the user's writing in the window.
  const [
    reflRes,
    decRes,
    winRes,
    intRes,
    stdRes,
    chkRes,
    qRes,
    obsRes,
    idRes,
  ] = await Promise.all([
    supabase.from("reflections").select("text, kind, created_at").eq("user_id", user.id).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(40),
    supabase.from("decisions").select("title, choice, expected_outcome, created_at").eq("user_id", user.id).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(20),
    supabase.from("wins").select("text, kind, created_at").eq("user_id", user.id).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(20),
    supabase.from("intentions").select("text, log_date, completed_at").eq("user_id", user.id).gte("log_date", sinceDate).order("log_date", { ascending: false }).limit(30),
    supabase.from("standups").select("log_date, yesterday, today, blockers").eq("user_id", user.id).gte("log_date", sinceDate).order("log_date", { ascending: false }).limit(20),
    supabase.from("daily_checkins").select("log_date, energy, mood, focus, note").eq("user_id", user.id).gte("log_date", sinceDate).order("log_date", { ascending: false }).limit(30),
    supabase.from("questions").select("text, kind, priority, created_at").eq("user_id", user.id).eq("status", "open").order("created_at", { ascending: false }).limit(15),
    supabase.from("observations").select("body, kind, created_at").eq("user_id", user.id).is("dismissed_at", null).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(10),
    supabase.from("identity_claims").select("kind, statement").eq("user_id", user.id).eq("status", "active").order("occurrences", { ascending: false }).limit(15),
  ]);

  const lines: string[] = [];
  const counts: Record<string, number> = {};
  let total = 0;

  const refl = (reflRes.data ?? []) as Array<{ text: string; kind: string | null; created_at: string }>;
  if (refl.length > 0) {
    counts.reflections = refl.length; total += refl.length;
    lines.push("Reflections:");
    for (const r of refl.slice(0, 18)) lines.push(`- (${isoToDate(r.created_at)}) [${r.kind ?? "reflection"}] ${r.text.replace(/\s+/g, " ").slice(0, 200)}`);
    lines.push("");
  }
  const dec = (decRes.data ?? []) as Array<{ title: string; choice: string | null; expected_outcome: string | null; created_at: string }>;
  if (dec.length > 0) {
    counts.decisions = dec.length; total += dec.length;
    lines.push("Decisions:");
    for (const d of dec.slice(0, 10)) lines.push(`- (${isoToDate(d.created_at)}) ${d.title}${d.choice ? ` — chose: ${d.choice}` : ""}${d.expected_outcome ? ` — expected: ${d.expected_outcome.slice(0, 120)}` : ""}`);
    lines.push("");
  }
  const wins = (winRes.data ?? []) as Array<{ text: string; kind: string | null; created_at: string }>;
  if (wins.length > 0) {
    counts.wins = wins.length; total += wins.length;
    lines.push("Wins:");
    for (const w of wins.slice(0, 10)) lines.push(`- (${isoToDate(w.created_at)}) [${w.kind ?? "win"}] ${w.text.slice(0, 160)}`);
    lines.push("");
  }
  const ints = (intRes.data ?? []) as Array<{ text: string; log_date: string; completed_at: string | null }>;
  if (ints.length > 0) {
    counts.intentions = ints.length; total += ints.length;
    const done = ints.filter((i) => i.completed_at).length;
    lines.push(`Intentions (${done}/${ints.length} completed):`);
    for (const i of ints.slice(0, 12)) lines.push(`- (${i.log_date}${i.completed_at ? ", ✓" : ""}) ${i.text.slice(0, 160)}`);
    lines.push("");
  }
  const stds = (stdRes.data ?? []) as Array<{ log_date: string; yesterday: string | null; today: string | null; blockers: string | null }>;
  if (stds.length > 0) {
    counts.standups = stds.length; total += stds.length;
    lines.push("Standups:");
    for (const s of stds.slice(0, 8)) {
      const parts = [s.yesterday && `y: ${s.yesterday}`, s.today && `t: ${s.today}`, s.blockers && `b: ${s.blockers}`].filter(Boolean).join(" | ");
      if (parts) lines.push(`- (${s.log_date}) ${parts.slice(0, 220)}`);
    }
    lines.push("");
  }
  const chks = (chkRes.data ?? []) as Array<{ log_date: string; energy: number | null; mood: number | null; focus: number | null; note: string | null }>;
  if (chks.length > 0) {
    counts.checkins = chks.length; total += chks.length;
    const avgE = chks.reduce((s, c) => s + (c.energy ?? 0), 0) / Math.max(1, chks.filter((c) => c.energy != null).length);
    const avgM = chks.reduce((s, c) => s + (c.mood ?? 0), 0) / Math.max(1, chks.filter((c) => c.mood != null).length);
    const avgF = chks.reduce((s, c) => s + (c.focus ?? 0), 0) / Math.max(1, chks.filter((c) => c.focus != null).length);
    lines.push(`Daily check-ins (avg e${avgE.toFixed(1)}/m${avgM.toFixed(1)}/f${avgF.toFixed(1)} over ${chks.length} days):`);
    for (const c of chks.slice(0, 12)) {
      if (c.note && c.note.trim().length > 0) lines.push(`- (${c.log_date}) e${c.energy ?? "?"}/m${c.mood ?? "?"}/f${c.focus ?? "?"} — ${c.note.slice(0, 180)}`);
    }
    lines.push("");
  }
  const qs = (qRes.data ?? []) as Array<{ text: string; kind: string; priority: number; created_at: string }>;
  if (qs.length > 0) {
    counts.open_questions = qs.length; total += qs.length;
    lines.push("Open questions you're carrying:");
    for (const q of qs.slice(0, 10)) lines.push(`- (since ${isoToDate(q.created_at)}, p${q.priority}) ${q.text.slice(0, 200)}`);
    lines.push("");
  }
  const obs = (obsRes.data ?? []) as Array<{ body: string; kind: string; created_at: string }>;
  if (obs.length > 0) {
    counts.observations = obs.length; total += obs.length;
    lines.push("Observations JARVIS has logged about you:");
    for (const o of obs.slice(0, 6)) lines.push(`- [${o.kind}] (${isoToDate(o.created_at)}) ${o.body.slice(0, 200)}`);
    lines.push("");
  }
  const ids = (idRes.data ?? []) as Array<{ kind: string; statement: string }>;
  if (ids.length > 0) {
    counts.identity = ids.length;
    lines.push("Active identity claims (your stated who-you-are, for context only):");
    for (const c of ids.slice(0, 10)) lines.push(`- [${c.kind}] ${c.statement.slice(0, 160)}`);
    lines.push("");
  }

  if (total < 6) {
    return NextResponse.json({
      error: `not enough writing in the last ${windowDays} days to mirror — write a few reflections / standups / check-ins first`,
    }, { status: 400 });
  }

  // Pull the previous mirror so we can ask for a drift note.
  const { data: previous } = await supabase
    .from("self_mirrors")
    .select("id, body, window_start, window_end, created_at")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const evidence = lines.join("\n");

  const system = [
    `You are writing a SELF-MIRROR for the user, dated ${nowDate}, covering the last ${windowDays} days.`,
    "",
    "A self-mirror is a SHORT THIRD-PERSON DESCRIPTION of who they appear to be in this window — not advice, not coaching, not a review. Just description, the way a perceptive friend who's known them for years might describe them after looking over their week.",
    "",
    "Output strict JSON with two fields:",
    "{",
    '  "body": "<a single paragraph, 120-220 words, third person, present tense, British English, no em-dashes, no moralising, no questions, no advice, no second person ‘you’, no headings, no bullet points>",',
    `  "drift_note": "<optional, omit or empty string if no previous mirror provided. ONE sentence, 12-30 words, second person 'you', British English, no em-dashes, naming the SHIFT from the previous mirror to this one — what's gained, lost, intensified, softened. Avoid generic 'you've grown'. Be specific.>"`,
    "}",
    "",
    "Body rules:",
    "- Refer to the user in the THIRD person ('he is...', 'she is...', or 'this person is...' — pick whichever flows; default to 'he' since the user's writing reads male; if unsure default to 'this person'). Stay consistent throughout.",
    "- Lead with a sharp opening sentence that captures the dominant note of the window. Don't start with 'this person is someone who...' or any other formulaic opener.",
    "- Anchor every claim in the evidence dump. Don't invent. If they had a hard week, say so. If they shipped, say so. If they were avoiding, say so.",
    "- Mention specific things — name a project, name a feeling, name a struggle — but no proper-noun namedropping for vanity. Just the substance.",
    "- It's allowed to be uncomfortable. It's allowed to be tender. It's not allowed to flatter.",
    "- No em-dashes. British English. No questions. No second person. No advice.",
    "",
    "Drift note rules:",
    "- Compare the previous mirror (if provided) to the new one. Name the actual movement — 'softer with himself than two weeks ago', 'shipping less but thinking more', 'the open loop on X has gone quiet'. Concrete, not vibey.",
    "- Skip when no previous mirror exists.",
  ].join("\n");

  const userMsg = [
    "EVIDENCE FROM THE LAST " + windowDays + " DAYS:",
    "",
    evidence,
    previous ? `\n=== PREVIOUS MIRROR (window ${previous.window_start} → ${previous.window_end}, written ${previous.created_at.slice(0, 10)}) ===\n\n${previous.body}` : "\n(no previous mirror exists yet — omit drift_note)",
  ].join("\n");

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

  let parsed: { body?: unknown; drift_note?: unknown };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  const finalBody = typeof parsed.body === "string" ? parsed.body.trim() : "";
  if (finalBody.length < 60) {
    return NextResponse.json({ error: "model returned an empty mirror body" }, { status: 502 });
  }
  const driftNote = typeof parsed.drift_note === "string" ? parsed.drift_note.trim() : "";

  const { data: inserted, error: iErr } = await supabase
    .from("self_mirrors")
    .insert({
      user_id: user.id,
      body: finalBody.slice(0, 2400),
      drift_note: previous && driftNote.length > 0 ? driftNote.slice(0, 400) : null,
      window_days: windowDays,
      window_start: sinceDate,
      window_end: nowDate,
      source_counts: counts,
      parent_id: previous?.id ?? null,
    })
    .select("id, body, drift_note, window_days, window_start, window_end, source_counts, parent_id, user_note, pinned, archived_at, created_at")
    .single();
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  return NextResponse.json({ mirror: inserted });
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "active";
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 30;

  let q = supabase
    .from("self_mirrors")
    .select("id, body, drift_note, window_days, window_start, window_end, source_counts, parent_id, user_note, pinned, archived_at, created_at")
    .eq("user_id", user.id);
  if (status === "active") q = q.is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
  q = q.order("created_at", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ mirrors: data ?? [] });
}
