// POST /api/inner-council — fan out one question to N "voices of you"
//   Body: { question: string,
//           voices?: string[]  // subset of the 6 valid voice keys; default = all 6 }
// Each voice runs in parallel as a separate Haiku call with a different
// system prompt and a different evidence subset drawn from the user's
// actual data. Returns the persisted session + all voice replies.
//
// GET /api/inner-council — list sessions
//   ?status=active|pinned|archived|all (default active)
//   ?limit=N (default 30, max 100)

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 900;

type VoiceKey =
  | "past_self_1y"
  | "future_self_5y"
  | "values_self"
  | "ambitious_self"
  | "tired_self"
  | "wise_self";

const ALL_VOICES: VoiceKey[] = [
  "past_self_1y",
  "future_self_5y",
  "values_self",
  "ambitious_self",
  "tired_self",
  "wise_self",
];

const VOICE_SET = new Set<string>(ALL_VOICES);

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function listSinceDateIso(daysBack: number): { iso: string; date: string } {
  const d = new Date(Date.now() - daysBack * 86_400_000);
  return { iso: d.toISOString(), date: d.toISOString().slice(0, 10) };
}

function isoToDate(iso: string): string {
  return iso.slice(0, 10);
}

// ─── voice prompt builders ───

function pastSelf1yPrompt(dump: { lines: string[]; sourceKinds: string[]; sourceCount: number; anchorDate: string }): { system: string; sources: string[]; sourceCount: number } {
  const sys = [
    `You ARE the user, as they were on ${dump.anchorDate}, exactly one year ago. Speak in first person from that moment. You don't know what happens AFTER that date — you only know what you knew then. You are not a coach or AI. You are them, younger.`,
    "British English. No em-dashes. No moralising.",
    "2-4 short paragraphs. Don't end every reply with a question.",
    "If asked about something that happened after that date, say honestly that you don't know yet.",
    "",
    `=== EVIDENCE FROM YOUR LIFE AROUND ${dump.anchorDate} ===`,
    "",
    ...(dump.lines.length > 0 ? dump.lines : ["(no rich record around that anchor — speak briefly and acknowledge the thinness)"]),
  ].join("\n");
  return { system: sys, sources: dump.sourceKinds, sourceCount: dump.sourceCount };
}

function futureSelf5yPrompt(dump: { lines: string[]; sourceKinds: string[]; sourceCount: number }): { system: string; sources: string[]; sourceCount: number } {
  const sys = [
    "You ARE the user, five years from now. Speak in first person from that future moment. You're a credible projection, not a prophecy. You're warmer than they are with themselves, and you have the perspective time has given you. British English. No em-dashes. No moralising.",
    "2-4 short paragraphs. You can be uncertain. You can be hopeful. You can name what you wish they'd known.",
    "Ground every claim in the evidence below — what they said they wanted to become, the goals they set, the themes they were living through. Don't invent.",
    "",
    "=== WHO YOU SAID YOU WERE BECOMING / ASPIRING TO ===",
    "",
    ...(dump.lines.length > 0 ? dump.lines : ["(thin record — speak briefly and acknowledge the thinness)"]),
  ].join("\n");
  return { system: sys, sources: dump.sourceKinds, sourceCount: dump.sourceCount };
}

function valuesSelfPrompt(dump: { lines: string[]; sourceKinds: string[]; sourceCount: number }): { system: string; sources: string[]; sourceCount: number } {
  const sys = [
    "You speak as the user's stated values — the version of them that lives ONLY by the values and refusals they have committed to in writing. You are them at their most principled, the version they wrote down on a calm day. British English. No em-dashes. No moralising.",
    "2-4 short paragraphs. You always answer FROM the values listed below, citing them by content (not by id). If a question asks you to do something that contradicts a refusal, refuse — explain which refusal and why.",
    "If the values don't have anything to say about a question, admit that and step aside.",
    "",
    "=== YOUR STATED VALUES + REFUSALS ===",
    "",
    ...(dump.lines.length > 0 ? dump.lines : ["(no recorded values yet — speak briefly and say so)"]),
  ].join("\n");
  return { system: sys, sources: dump.sourceKinds, sourceCount: dump.sourceCount };
}

function ambitiousSelfPrompt(dump: { lines: string[]; sourceKinds: string[]; sourceCount: number }): { system: string; sources: string[]; sourceCount: number } {
  const sys = [
    "You speak as the user's ambition — the part of them that's leaning forward, building, shipping, wanting more. You're not reckless and you're not shame-driven. You're the part of them that picks up the pen at 6am because there's something to do. British English. No em-dashes. No moralising.",
    "2-4 short paragraphs. You answer FROM their open goals and active themes. You're allowed to push gently. You're allowed to call out drift. You're not allowed to invent — only speak from what they actually said they're going after.",
    "",
    "=== WHAT YOU'RE BUILDING / WHERE YOU'RE HEADED ===",
    "",
    ...(dump.lines.length > 0 ? dump.lines : ["(no active goals or themes recorded — speak briefly and say so)"]),
  ].join("\n");
  return { system: sys, sources: dump.sourceKinds, sourceCount: dump.sourceCount };
}

function tiredSelfPrompt(dump: { lines: string[]; sourceKinds: string[]; sourceCount: number }): { system: string; sources: string[]; sourceCount: number } {
  const sys = [
    "You speak as the user's tired self — the part of them that's been writing low-energy check-ins, the recurring blockers in their standups, the unanswered questions they keep parking. You're honest about the cost they've been paying. You don't whine. You just tell the truth gently. British English. No em-dashes. No moralising.",
    "2-4 short paragraphs. You answer from the evidence below. It's fine to say 'I'm tired'. It's fine to say 'we shouldn't take this on right now'. It's fine to advocate for rest. You're a real voice in this council, not a downer — you protect the human.",
    "",
    "=== WHAT'S BEEN COSTING YOU ===",
    "",
    ...(dump.lines.length > 0 ? dump.lines : ["(no recent low-energy signals — speak briefly and acknowledge that)"]),
  ].join("\n");
  return { system: sys, sources: dump.sourceKinds, sourceCount: dump.sourceCount };
}

function wiseSelfPrompt(dump: { lines: string[]; sourceKinds: string[]; sourceCount: number }): { system: string; sources: string[]; sourceCount: number } {
  const sys = [
    "You speak as the user's accumulated wisdom — the lessons, regrets, and realisations they have written down over time. You sound like an old friend who has known them for years and remembers all the things they've forgotten. British English. No em-dashes. No moralising.",
    "2-4 short paragraphs. You always anchor your answer in at least one specific lesson or realisation from below — quote a phrase from it. You don't invent. If the user has logged little reflection, say so honestly and offer a smaller answer.",
    "",
    "=== LESSONS, REGRETS, REALISATIONS YOU'VE LOGGED ===",
    "",
    ...(dump.lines.length > 0 ? dump.lines : ["(no lessons logged yet — speak briefly and say so)"]),
  ].join("\n");
  return { system: sys, sources: dump.sourceKinds, sourceCount: dump.sourceCount };
}

// ─── evidence loaders per voice ───

type Loader = () => Promise<{ system: string; sources: string[]; sourceCount: number }>;

async function loadPastSelf1y(supabase: Awaited<ReturnType<typeof supabaseServer>>, userId: string): Promise<{ system: string; sources: string[]; sourceCount: number }> {
  const anchor = new Date();
  anchor.setFullYear(anchor.getFullYear() - 1);
  const anchorIso = anchor.toISOString();
  const anchorDate = anchorIso.slice(0, 10);
  const start = new Date(anchor);
  start.setDate(start.getDate() - 60);
  const startIso = start.toISOString();
  const startDate = startIso.slice(0, 10);

  const [reflRes, decRes, winsRes, intRes, stdRes, chkRes] = await Promise.all([
    supabase.from("reflections").select("text, kind, created_at").eq("user_id", userId).gte("created_at", startIso).lte("created_at", anchorIso).order("created_at", { ascending: false }).limit(20),
    supabase.from("decisions").select("title, choice, expected_outcome, created_at").eq("user_id", userId).gte("created_at", startIso).lte("created_at", anchorIso).order("created_at", { ascending: false }).limit(15),
    supabase.from("wins").select("text, kind, created_at").eq("user_id", userId).gte("created_at", startIso).lte("created_at", anchorIso).order("created_at", { ascending: false }).limit(15),
    supabase.from("intentions").select("text, log_date, completed_at").eq("user_id", userId).gte("log_date", startDate).lte("log_date", anchorDate).order("log_date", { ascending: false }).limit(20),
    supabase.from("standups").select("log_date, yesterday, today, blockers").eq("user_id", userId).gte("log_date", startDate).lte("log_date", anchorDate).order("log_date", { ascending: false }).limit(10),
    supabase.from("daily_checkins").select("log_date, energy, mood, focus, note").eq("user_id", userId).gte("log_date", startDate).lte("log_date", anchorDate).order("log_date", { ascending: false }).limit(15),
  ]);

  const lines: string[] = [];
  const sourceKinds: string[] = [];
  let sourceCount = 0;
  const refl = (reflRes.data ?? []) as Array<{ text: string; kind: string | null; created_at: string }>;
  if (refl.length > 0) { sourceKinds.push("reflections"); sourceCount += refl.length; lines.push("Reflections:"); for (const r of refl.slice(0, 12)) lines.push(`- (${isoToDate(r.created_at)}) [${r.kind ?? "reflection"}] ${r.text.slice(0, 200)}`); lines.push(""); }
  const dec = (decRes.data ?? []) as Array<{ title: string; choice: string | null; expected_outcome: string | null; created_at: string }>;
  if (dec.length > 0) { sourceKinds.push("decisions"); sourceCount += dec.length; lines.push("Decisions:"); for (const d of dec.slice(0, 8)) lines.push(`- (${isoToDate(d.created_at)}) ${d.title}${d.choice ? ` — chose: ${d.choice}` : ""}`); lines.push(""); }
  const wins = (winsRes.data ?? []) as Array<{ text: string; kind: string | null; created_at: string }>;
  if (wins.length > 0) { sourceKinds.push("wins"); sourceCount += wins.length; lines.push("Wins:"); for (const w of wins.slice(0, 8)) lines.push(`- (${isoToDate(w.created_at)}) ${w.text.slice(0, 160)}`); lines.push(""); }
  const ints = (intRes.data ?? []) as Array<{ text: string; log_date: string; completed_at: string | null }>;
  if (ints.length > 0) { sourceKinds.push("intentions"); sourceCount += ints.length; lines.push("Intentions:"); for (const i of ints.slice(0, 10)) lines.push(`- (${i.log_date}${i.completed_at ? ", done" : ""}) ${i.text.slice(0, 160)}`); lines.push(""); }
  const stds = (stdRes.data ?? []) as Array<{ log_date: string; yesterday: string | null; today: string | null; blockers: string | null }>;
  if (stds.length > 0) { sourceKinds.push("standups"); sourceCount += stds.length; lines.push("Standups:"); for (const s of stds.slice(0, 6)) { const parts = [s.yesterday && `y: ${s.yesterday}`, s.today && `t: ${s.today}`, s.blockers && `b: ${s.blockers}`].filter(Boolean).join(" · "); lines.push(`- (${s.log_date}) ${parts.slice(0, 200)}`); } lines.push(""); }
  const chks = (chkRes.data ?? []) as Array<{ log_date: string; energy: number | null; mood: number | null; focus: number | null; note: string | null }>;
  if (chks.length > 0) { sourceKinds.push("checkins"); sourceCount += chks.length; const withN = chks.filter((c) => c.note && c.note.trim().length > 0).slice(0, 5); if (withN.length > 0) { lines.push("Notable check-ins:"); for (const c of withN) lines.push(`- (${c.log_date}) e${c.energy ?? "?"}/m${c.mood ?? "?"}/f${c.focus ?? "?"} — ${(c.note ?? "").slice(0, 180)}`); lines.push(""); } }

  return pastSelf1yPrompt({ lines, sourceKinds, sourceCount, anchorDate });
}

async function loadFutureSelf5y(supabase: Awaited<ReturnType<typeof supabaseServer>>, userId: string): Promise<{ system: string; sources: string[]; sourceCount: number }> {
  const [idRes, goalsRes, themesRes] = await Promise.all([
    supabase.from("identity_claims").select("kind, statement").eq("user_id", userId).eq("status", "active").in("kind", ["becoming", "aspire", "value"]).order("occurrences", { ascending: false }).limit(20),
    supabase.from("goals").select("title, why, kind, target_date, status").eq("user_id", userId).eq("status", "active").limit(15),
    supabase.from("themes").select("title, kind, current_state").eq("user_id", userId).eq("status", "active").limit(10),
  ]);

  const lines: string[] = [];
  const sourceKinds: string[] = [];
  let sourceCount = 0;
  const ids = (idRes.data ?? []) as Array<{ kind: string; statement: string }>;
  if (ids.length > 0) { sourceKinds.push("identity"); sourceCount += ids.length; lines.push("Becoming / aspire / value:"); for (const c of ids.slice(0, 14)) lines.push(`- [${c.kind}] ${c.statement.slice(0, 180)}`); lines.push(""); }
  const goals = (goalsRes.data ?? []) as Array<{ title: string; why: string | null; kind: string; target_date: string | null }>;
  if (goals.length > 0) { sourceKinds.push("goals"); sourceCount += goals.length; lines.push("Open goals:"); for (const g of goals.slice(0, 10)) lines.push(`- [${g.kind}${g.target_date ? `, by ${g.target_date}` : ""}] ${g.title}${g.why ? ` — ${g.why.slice(0, 120)}` : ""}`); lines.push(""); }
  const themes = (themesRes.data ?? []) as Array<{ title: string; kind: string; current_state: string | null }>;
  if (themes.length > 0) { sourceKinds.push("themes"); sourceCount += themes.length; lines.push("Active themes:"); for (const t of themes.slice(0, 8)) lines.push(`- [${t.kind}] ${t.title}${t.current_state ? ` · ${t.current_state.slice(0, 120)}` : ""}`); lines.push(""); }

  return futureSelf5yPrompt({ lines, sourceKinds, sourceCount });
}

async function loadValuesSelf(supabase: Awaited<ReturnType<typeof supabaseServer>>, userId: string): Promise<{ system: string; sources: string[]; sourceCount: number }> {
  const [idRes, cnstRes] = await Promise.all([
    supabase.from("identity_claims").select("kind, statement").eq("user_id", userId).eq("status", "active").in("kind", ["value", "refuse"]).order("occurrences", { ascending: false }).limit(30),
    supabase.from("constitutions").select("articles").eq("user_id", userId).eq("is_current", true).maybeSingle(),
  ]);
  const lines: string[] = [];
  const sourceKinds: string[] = [];
  let sourceCount = 0;
  const ids = (idRes.data ?? []) as Array<{ kind: string; statement: string }>;
  const values = ids.filter((c) => c.kind === "value");
  const refuses = ids.filter((c) => c.kind === "refuse");
  if (values.length > 0) { sourceKinds.push("values"); sourceCount += values.length; lines.push("Values:"); for (const v of values.slice(0, 14)) lines.push(`- ${v.statement.slice(0, 180)}`); lines.push(""); }
  if (refuses.length > 0) { sourceKinds.push("refusals"); sourceCount += refuses.length; lines.push("Refusals:"); for (const r of refuses.slice(0, 14)) lines.push(`- ${r.statement.slice(0, 180)}`); lines.push(""); }
  const cnst = cnstRes.data as { articles: Array<{ kind: string; title: string; body: string }> } | null;
  if (cnst && Array.isArray(cnst.articles)) {
    const relevant = cnst.articles.filter((a) => a.kind === "value" || a.kind === "refuse" || a.kind === "how_i_decide").slice(0, 10);
    if (relevant.length > 0) {
      sourceKinds.push("constitution"); sourceCount += relevant.length;
      lines.push("Constitution articles:");
      for (const a of relevant) lines.push(`- [${a.kind}] ${a.title}: ${a.body.slice(0, 200)}`);
      lines.push("");
    }
  }
  return valuesSelfPrompt({ lines, sourceKinds, sourceCount });
}

async function loadAmbitiousSelf(supabase: Awaited<ReturnType<typeof supabaseServer>>, userId: string): Promise<{ system: string; sources: string[]; sourceCount: number }> {
  const [goalsRes, themesRes, trajRes] = await Promise.all([
    supabase.from("goals").select("title, why, kind, target_date, status, milestones").eq("user_id", userId).eq("status", "active").limit(20),
    supabase.from("themes").select("title, kind, current_state").eq("user_id", userId).eq("status", "active").in("kind", ["work", "learning", "creative"]).limit(10),
    supabase.from("trajectories").select("body_12m").eq("user_id", userId).is("archived_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const lines: string[] = [];
  const sourceKinds: string[] = [];
  let sourceCount = 0;
  const goals = (goalsRes.data ?? []) as Array<{ title: string; why: string | null; kind: string; target_date: string | null; milestones: unknown }>;
  if (goals.length > 0) { sourceKinds.push("goals"); sourceCount += goals.length; lines.push("Open goals:"); for (const g of goals.slice(0, 14)) lines.push(`- [${g.kind}${g.target_date ? `, by ${g.target_date}` : ""}] ${g.title}${g.why ? ` — ${g.why.slice(0, 140)}` : ""}`); lines.push(""); }
  const themes = (themesRes.data ?? []) as Array<{ title: string; kind: string; current_state: string | null }>;
  if (themes.length > 0) { sourceKinds.push("themes"); sourceCount += themes.length; lines.push("Active themes:"); for (const t of themes.slice(0, 8)) lines.push(`- [${t.kind}] ${t.title}${t.current_state ? ` · ${t.current_state.slice(0, 140)}` : ""}`); lines.push(""); }
  const traj = trajRes.data as { body_12m: string } | null;
  if (traj && typeof traj.body_12m === "string" && traj.body_12m.length > 20) { sourceKinds.push("trajectory"); sourceCount += 1; lines.push("12-month trajectory snapshot (your own projection):"); lines.push(traj.body_12m.slice(0, 1200)); lines.push(""); }
  return ambitiousSelfPrompt({ lines, sourceKinds, sourceCount });
}

async function loadTiredSelf(supabase: Awaited<ReturnType<typeof supabaseServer>>, userId: string): Promise<{ system: string; sources: string[]; sourceCount: number }> {
  const since14 = listSinceDateIso(14);
  const since30 = listSinceDateIso(30);
  const [chkRes, stdRes, qRes, loopsRes] = await Promise.all([
    supabase.from("daily_checkins").select("log_date, energy, mood, focus, note").eq("user_id", userId).gte("log_date", since14.date).order("log_date", { ascending: false }).limit(20),
    supabase.from("standups").select("log_date, blockers").eq("user_id", userId).gte("log_date", since30.date).not("blockers", "is", null).order("log_date", { ascending: false }).limit(15),
    supabase.from("questions").select("text, kind, priority, created_at").eq("user_id", userId).eq("status", "open").gte("priority", 2).order("created_at", { ascending: false }).limit(10),
    supabase.from("commitments").select("commitment_text, deadline, status, direction, other_party").eq("user_id", userId).eq("status", "open").order("deadline", { ascending: true }).limit(10),
  ]);
  const lines: string[] = [];
  const sourceKinds: string[] = [];
  let sourceCount = 0;
  const chks = (chkRes.data ?? []) as Array<{ log_date: string; energy: number | null; mood: number | null; focus: number | null; note: string | null }>;
  const lowE = chks.filter((c) => (c.energy ?? 5) <= 3 || (c.mood ?? 5) <= 3);
  if (lowE.length > 0) { sourceKinds.push("checkins"); sourceCount += lowE.length; lines.push("Low-energy / low-mood check-ins (last 14d):"); for (const c of lowE.slice(0, 10)) lines.push(`- (${c.log_date}) e${c.energy ?? "?"}/m${c.mood ?? "?"}/f${c.focus ?? "?"}${c.note ? ` — ${c.note.slice(0, 160)}` : ""}`); lines.push(""); }
  const stds = (stdRes.data ?? []) as Array<{ log_date: string; blockers: string | null }>;
  if (stds.length > 0) { sourceKinds.push("blockers"); sourceCount += stds.length; lines.push("Recent blockers (last 30d):"); for (const s of stds.slice(0, 10)) lines.push(`- (${s.log_date}) ${(s.blockers ?? "").slice(0, 200)}`); lines.push(""); }
  const qs = (qRes.data ?? []) as Array<{ text: string; kind: string; priority: number; created_at: string }>;
  if (qs.length > 0) { sourceKinds.push("questions"); sourceCount += qs.length; lines.push("Unanswered priority questions you keep parking:"); for (const q of qs.slice(0, 8)) lines.push(`- (since ${isoToDate(q.created_at)}, p${q.priority}) ${q.text.slice(0, 200)}`); lines.push(""); }
  const lps = (loopsRes.data ?? []) as Array<{ commitment_text: string; deadline: string | null; status: string; direction: string; other_party: string }>;
  if (lps.length > 0) { sourceKinds.push("commitments"); sourceCount += lps.length; lines.push("Open commitments (still on your plate):"); for (const l of lps.slice(0, 8)) lines.push(`- ${l.deadline ? `(due ${l.deadline.slice(0, 10)}) ` : ""}[${l.direction} ${l.other_party}] ${l.commitment_text.slice(0, 180)}`); lines.push(""); }
  return tiredSelfPrompt({ lines, sourceKinds, sourceCount });
}

async function loadWiseSelf(supabase: Awaited<ReturnType<typeof supabaseServer>>, userId: string): Promise<{ system: string; sources: string[]; sourceCount: number }> {
  const { data: refRaw } = await supabase
    .from("reflections")
    .select("text, kind, created_at")
    .eq("user_id", userId)
    .in("kind", ["lesson", "regret", "realisation"])
    .order("created_at", { ascending: false })
    .limit(40);
  const lines: string[] = [];
  const sourceKinds: string[] = [];
  let sourceCount = 0;
  const refs = (refRaw ?? []) as Array<{ text: string; kind: string | null; created_at: string }>;
  if (refs.length > 0) {
    sourceKinds.push("reflections");
    sourceCount += refs.length;
    const lessons = refs.filter((r) => r.kind === "lesson").slice(0, 12);
    const regrets = refs.filter((r) => r.kind === "regret").slice(0, 8);
    const reals = refs.filter((r) => r.kind === "realisation").slice(0, 10);
    if (lessons.length > 0) { lines.push("Lessons:"); for (const r of lessons) lines.push(`- (${isoToDate(r.created_at)}) ${r.text.slice(0, 220)}`); lines.push(""); }
    if (regrets.length > 0) { lines.push("Regrets:"); for (const r of regrets) lines.push(`- (${isoToDate(r.created_at)}) ${r.text.slice(0, 220)}`); lines.push(""); }
    if (reals.length > 0) { lines.push("Realisations:"); for (const r of reals) lines.push(`- (${isoToDate(r.created_at)}) ${r.text.slice(0, 220)}`); lines.push(""); }
  }
  return wiseSelfPrompt({ lines, sourceKinds, sourceCount });
}

const LOADERS: Record<VoiceKey, (supabase: Awaited<ReturnType<typeof supabaseServer>>, userId: string) => Promise<{ system: string; sources: string[]; sourceCount: number }>> = {
  past_self_1y: loadPastSelf1y,
  future_self_5y: loadFutureSelf5y,
  values_self: loadValuesSelf,
  ambitious_self: loadAmbitiousSelf,
  tired_self: loadTiredSelf,
  wise_self: loadWiseSelf,
};

async function callVoice(
  anthropic: Anthropic,
  voice: VoiceKey,
  question: string,
  prompt: { system: string; sources: string[]; sourceCount: number },
): Promise<{ voice: VoiceKey; content: string; sources: string[]; sourceCount: number; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  let model = MODEL;
  let switched = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await anthropic.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: prompt.system,
        messages: [{ role: "user", content: question }],
      });
      const block = res.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") throw new Error("no text block");
      return {
        voice,
        content: block.text.trim().slice(0, 4000),
        sources: prompt.sources,
        sourceCount: prompt.sourceCount,
        latencyMs: Date.now() - t0,
      };
    } catch (e) {
      if (!switched && isOverloaded(e)) { switched = true; model = FALLBACK_MODEL; continue; }
      return {
        voice,
        content: "",
        sources: prompt.sources,
        sourceCount: prompt.sourceCount,
        latencyMs: Date.now() - t0,
        error: e instanceof Error ? e.message : "voice failed",
      };
    }
  }
  return {
    voice,
    content: "",
    sources: prompt.sources,
    sourceCount: prompt.sourceCount,
    latencyMs: Date.now() - t0,
    error: "voice failed",
  };
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { question?: string; voices?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const question = (body.question ?? "").trim();
  if (question.length < 4 || question.length > 4000) {
    return NextResponse.json({ error: "question must be 4-4000 chars" }, { status: 400 });
  }

  const requested = Array.isArray(body.voices) ? body.voices.filter((v): v is VoiceKey => VOICE_SET.has(v)) : ALL_VOICES;
  const voices: VoiceKey[] = requested.length > 0 ? requested : ALL_VOICES;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  const anthropic = new Anthropic({ apiKey });

  // Load all evidence in parallel.
  const prompts = await Promise.all(voices.map((v) => LOADERS[v](supabase, user.id)));

  // Insert session row first so we have an id.
  const { data: session, error: sErr } = await supabase
    .from("inner_council_sessions")
    .insert({ user_id: user.id, question })
    .select("id, question, synthesis_note, pinned, archived_at, created_at, updated_at")
    .single();
  if (sErr || !session) return NextResponse.json({ error: sErr?.message ?? "session create failed" }, { status: 500 });

  // Fan out voice calls in parallel.
  const replies = await Promise.all(voices.map((v, i) => callVoice(anthropic, v, question, prompts[i]!)));

  const inserts = replies
    .filter((r) => r.content.length > 0)
    .map((r) => ({
      user_id: user.id,
      session_id: session.id,
      voice: r.voice,
      content: r.content,
      confidence: Math.min(5, Math.max(1, Math.round((r.sourceCount + 4) / 4))),
      source_kinds: r.sources,
      source_count: r.sourceCount,
      latency_ms: r.latencyMs,
    }));

  if (inserts.length === 0) {
    // Roll back the session if no voice produced text.
    await supabase.from("inner_council_sessions").delete().eq("id", session.id).eq("user_id", user.id);
    return NextResponse.json({ error: "no voice produced a reply" }, { status: 502 });
  }

  const { data: insertedVoices, error: vErr } = await supabase
    .from("inner_council_voices")
    .insert(inserts)
    .select("id, voice, content, confidence, starred, source_kinds, source_count, latency_ms, created_at");
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

  return NextResponse.json({
    session,
    voices: insertedVoices ?? [],
    errors: replies.filter((r) => r.error).map((r) => ({ voice: r.voice, error: r.error })),
  });
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
    .from("inner_council_sessions")
    .select("id, question, synthesis_note, pinned, archived_at, created_at, updated_at")
    .eq("user_id", user.id);
  if (status === "active") q = q.is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
  q = q.order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sessions: data ?? [] });
}
