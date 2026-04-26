// POST /api/reverse-briefs — reverse-engineer the user's IMPLICIT mental
// model from a single day's behaviour. Pulls intentions / standup /
// daily check-in / decisions / reflections / wins / commitments handled
// + active identity claims + active themes, asks Haiku to infer 3-6
// implicit beliefs that would make the day's choices coherent. Compares
// implicit beliefs against the user's stated identity to surface
// CONFLICTS — the gap between who you say you are and what you act
// like. Upserts on (user_id, brief_date) so re-running the same date
// overwrites instead of duplicating.
//
// Body: { brief_date?: YYYY-MM-DD (default = today's date in user's
//         local timezone, but we use UTC date here for simplicity) }
//
// GET /api/reverse-briefs — list briefs.
//   ?status=open|acknowledged|contested|dismissed|resolved|archived|pinned|all (default open)
//   ?limit=N (default 30, max 100)

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 2400;

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function dateOnly(iso: string): string { return iso.slice(0, 10); }
function isValidDate(s: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(s); }

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { brief_date?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const todayDate = dateOnly(new Date().toISOString());
  const briefDate = body.brief_date && isValidDate(body.brief_date) ? body.brief_date : todayDate;

  // Don't allow future dates
  if (briefDate > todayDate) {
    return NextResponse.json({ error: "brief_date must be today or in the past" }, { status: 400 });
  }

  const t0 = Date.now();
  const dayStartIso = `${briefDate}T00:00:00.000Z`;
  const dayEndIso = `${briefDate}T23:59:59.999Z`;

  const [
    intentionRes,
    standupRes,
    checkinRes,
    decisionsRes,
    reflectionsRes,
    winsRes,
    commitmentsRes,
    identityRes,
    themesRes,
  ] = await Promise.all([
    supabase.from("intentions").select("text, completed_at, log_date").eq("user_id", user.id).eq("log_date", briefDate).maybeSingle(),
    supabase.from("standups").select("today, blockers, log_date").eq("user_id", user.id).eq("log_date", briefDate).maybeSingle(),
    supabase.from("daily_checkins").select("energy, mood, focus, note, log_date").eq("user_id", user.id).eq("log_date", briefDate).maybeSingle(),
    supabase.from("decisions").select("title, choice, expected_outcome, tags, created_at").eq("user_id", user.id).gte("created_at", dayStartIso).lte("created_at", dayEndIso).order("created_at", { ascending: true }).limit(20),
    supabase.from("reflections").select("text, kind, tags, created_at").eq("user_id", user.id).gte("created_at", dayStartIso).lte("created_at", dayEndIso).order("created_at", { ascending: true }).limit(20),
    supabase.from("wins").select("text, kind, created_at").eq("user_id", user.id).gte("created_at", dayStartIso).lte("created_at", dayEndIso).order("created_at", { ascending: true }).limit(20),
    supabase.from("commitments").select("commitment_text, direction, other_party, status, deadline, updated_at").eq("user_id", user.id).eq("status", "done").gte("updated_at", dayStartIso).lte("updated_at", dayEndIso).limit(20),
    supabase.from("identity_claims").select("statement, kind, occurrences").eq("user_id", user.id).eq("status", "active").order("occurrences", { ascending: false }).limit(20),
    supabase.from("themes").select("title, current_state, status").eq("user_id", user.id).eq("status", "active").order("updated_at", { ascending: false }).limit(15),
  ]);

  const intention = intentionRes.data as { text: string; completed_at: string | null; log_date: string } | null;
  const standup = standupRes.data as { today: string | null; blockers: string | null; log_date: string } | null;
  const checkin = checkinRes.data as { energy: number | null; mood: number | null; focus: number | null; note: string | null; log_date: string } | null;
  const decisions = (decisionsRes.data ?? []) as Array<{ title: string; choice: string | null; expected_outcome: string | null; tags: string[] | null; created_at: string }>;
  const reflections = (reflectionsRes.data ?? []) as Array<{ text: string; kind: string; tags: string[] | null; created_at: string }>;
  const wins = (winsRes.data ?? []) as Array<{ text: string; kind: string | null; created_at: string }>;
  const commitments = (commitmentsRes.data ?? []) as Array<{ commitment_text: string; direction: string; other_party: string; status: string; deadline: string | null; updated_at: string }>;
  const identityClaims = (identityRes.data ?? []) as Array<{ statement: string; kind: string; occurrences: number }>;
  const themes = (themesRes.data ?? []) as Array<{ title: string; current_state: string | null; status: string }>;

  const totalEvidence =
    (intention ? 1 : 0) +
    (standup && (standup.today || standup.blockers) ? 1 : 0) +
    (checkin ? 1 : 0) +
    decisions.length + reflections.length + wins.length + commitments.length;

  if (totalEvidence < 3) {
    return NextResponse.json({ error: "not enough activity logged on this day to reverse-engineer a brief — need at least 3 of: intention, standup, check-in, decision, reflection, win, commitment-handled" }, { status: 400 });
  }

  const lines: string[] = [];
  lines.push(`DATE: ${briefDate}`);
  lines.push("");

  if (intention?.text) {
    lines.push(`INTENTION SET FOR THE DAY: ${intention.text.slice(0, 400)}`);
    lines.push(`INTENTION COMPLETED: ${intention.completed_at ? "yes" : "no / not marked"}`);
    lines.push("");
  }
  if (standup) {
    if (standup.today) lines.push(`STANDUP — TODAY: ${standup.today.slice(0, 600)}`);
    if (standup.blockers) lines.push(`STANDUP — BLOCKERS: ${standup.blockers.slice(0, 400)}`);
    lines.push("");
  }
  if (checkin) {
    const parts: string[] = [];
    if (checkin.energy != null) parts.push(`energy ${checkin.energy}/5`);
    if (checkin.mood != null) parts.push(`mood ${checkin.mood}/5`);
    if (checkin.focus != null) parts.push(`focus ${checkin.focus}/5`);
    lines.push(`DAILY CHECK-IN: ${parts.join(", ") || "no scores"}${checkin.note ? ` — ${checkin.note.slice(0, 240)}` : ""}`);
    lines.push("");
  }
  if (decisions.length) {
    lines.push(`DECISIONS LOGGED (${decisions.length}):`);
    for (const d of decisions) lines.push(`- ${d.title}${d.choice ? ` — chose: ${d.choice.slice(0, 200)}` : ""}${d.expected_outcome ? ` [expected: ${d.expected_outcome.slice(0, 150)}]` : ""}${d.tags?.length ? ` [#${d.tags.slice(0, 4).join(", #")}]` : ""}`);
    lines.push("");
  }
  if (reflections.length) {
    lines.push(`REFLECTIONS (${reflections.length}):`);
    for (const r of reflections) lines.push(`- [${r.kind}] ${r.text.slice(0, 320)}`);
    lines.push("");
  }
  if (wins.length) {
    lines.push(`WINS (${wins.length}):`);
    for (const w of wins) lines.push(`- ${w.text.slice(0, 200)}`);
    lines.push("");
  }
  if (commitments.length) {
    lines.push(`COMMITMENTS HANDLED TODAY (${commitments.length}):`);
    for (const c of commitments) lines.push(`- ${c.direction === "outbound" ? "to" : "from"} ${c.other_party}: ${c.commitment_text.slice(0, 240)}`);
    lines.push("");
  }

  if (identityClaims.length) {
    lines.push("USER'S STATED IDENTITY (active claims, for the CONFLICTS pass):");
    for (const ic of identityClaims.slice(0, 14)) lines.push(`- [${ic.kind}] ${ic.statement.slice(0, 200)}`);
    lines.push("");
  }
  if (themes.length) {
    lines.push("ACTIVE THEMES:");
    for (const t of themes.slice(0, 10)) lines.push(`- ${t.title}${t.current_state ? `: ${t.current_state.slice(0, 160)}` : ""}`);
    lines.push("");
  }

  const system = [
    "You are doing ARCHAEOLOGY OF BELIEF — looking at one day of the user's behaviour and inferring what they MUST have implicitly believed for those choices to make sense. The user's actions reveal their real working model, not their stated one.",
    "",
    "Output strict JSON ONLY:",
    `{"summary": "2-3 sentence paragraph in second-person...", "implicit_beliefs": [{"belief": "...", "evidence": "...", "confidence": 1-5}, ...], "conflicts": [{"implicit": "...", "stated": "...", "tension_note": "..."}, ...]}`,
    "",
    "Rules for implicit_beliefs:",
    "- 3-6 beliefs. Don't pad. Each must be load-bearing for at least one specific action that day.",
    "- belief: ONE second-person sentence stating what the user must have been treating as true / important / acceptable / urgent (e.g. 'You were treating the agency project as more important than your sleep.', 'You were operating as if your energy is a renewable resource.', 'You were assuming the Marcus conversation can wait another week.').",
    "- DO NOT phrase as 'maybe you...' or 'it seems...' — STATE it. The user can contest. Hedging weakens the mirror.",
    "- evidence: ONE factual sentence quoting or paraphrasing the specific entries that reveal this belief (e.g. 'You worked through the standup-blocker about lack of sleep without resolving it, and your intention was a 12-hour deep-work block.').",
    "- confidence: 1-5 — how strongly the day's evidence supports this inference. 5 = the action only makes sense if you believed this; 1 = soft signal.",
    "- Cover different domains where possible (work, relationships, body, time, money, identity) — don't write 6 beliefs all about work.",
    "",
    "Rules for conflicts (optional, 0-3):",
    "- A conflict surfaces ONLY when an inferred implicit belief CONTRADICTS a stated identity claim or active theme.",
    "- implicit: copy the implicit belief.",
    "- stated: quote the contradicting identity claim or theme.",
    "- tension_note: ONE sentence naming the gap in second-person ('You say you refuse to grind, but you ground today.', 'You name family as a top value, but no family time appeared in the day.').",
    "- ONLY include genuine contradictions. If everything aligns, return [] for conflicts. Don't invent friction.",
    "",
    "Rules for summary:",
    "- 2-3 sentences in second-person, naming the SHAPE of the day from the inferred-belief angle (not a recap of what happened).",
    "- Lead with the most load-bearing implicit belief. End with the most uncomfortable conflict, if any.",
    "",
    "DO NOT moralise. DO NOT advise. DO NOT suggest changes. JUST NAME what the day's actions reveal you implicitly believed.",
    "British English, no em-dashes, no clichés, no hedging, no questions.",
  ].join("\n");

  const userMsg = ["EVIDENCE:", "", lines.join("\n")].join("\n");

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

  let parsed: { summary?: unknown; implicit_beliefs?: unknown[]; conflicts?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (typeof parsed.summary !== "string" || parsed.summary.trim().length < 20) {
    return NextResponse.json({ error: "model output missing or too-short summary" }, { status: 502 });
  }
  if (!Array.isArray(parsed.implicit_beliefs) || parsed.implicit_beliefs.length === 0) {
    return NextResponse.json({ error: "model output missing implicit_beliefs array" }, { status: 502 });
  }

  type RawBelief = { belief?: unknown; evidence?: unknown; confidence?: unknown };
  const beliefs: Array<{ belief: string; evidence: string | null; confidence: number }> = [];
  for (const b of parsed.implicit_beliefs as RawBelief[]) {
    const belief = typeof b.belief === "string" ? b.belief.trim().slice(0, 400) : "";
    const evidence = typeof b.evidence === "string" ? b.evidence.trim().slice(0, 400) : null;
    const confidence = typeof b.confidence === "number" ? Math.max(1, Math.min(5, Math.round(b.confidence))) : 3;
    if (belief.length < 12) continue;
    beliefs.push({ belief, evidence, confidence });
  }
  if (beliefs.length === 0) {
    return NextResponse.json({ error: "no valid implicit beliefs in model output" }, { status: 502 });
  }

  type RawConflict = { implicit?: unknown; stated?: unknown; tension_note?: unknown };
  const conflicts: Array<{ implicit: string; stated: string; tension_note: string }> = [];
  if (Array.isArray(parsed.conflicts)) {
    for (const c of parsed.conflicts as RawConflict[]) {
      const implicit = typeof c.implicit === "string" ? c.implicit.trim().slice(0, 400) : "";
      const stated = typeof c.stated === "string" ? c.stated.trim().slice(0, 400) : "";
      const tension = typeof c.tension_note === "string" ? c.tension_note.trim().slice(0, 400) : "";
      if (implicit.length >= 8 && stated.length >= 8 && tension.length >= 8) {
        conflicts.push({ implicit, stated, tension_note: tension });
      }
    }
  }

  const sourceCounts = {
    intention: intention ? 1 : 0,
    standup: standup ? 1 : 0,
    checkin: checkin ? 1 : 0,
    decisions: decisions.length,
    reflections: reflections.length,
    wins: wins.length,
    commitments: commitments.length,
    identity_claims: identityClaims.length,
    themes: themes.length,
  };
  const sourceSummary = `${totalEvidence} entries · ${decisions.length}d ${reflections.length}r ${wins.length}w ${commitments.length}c`;
  const latencyMs = Date.now() - t0;

  const upsertRow = {
    user_id: user.id,
    brief_date: briefDate,
    implicit_beliefs: beliefs,
    summary: parsed.summary.trim().slice(0, 1200),
    conflicts,
    source_summary: sourceSummary,
    source_counts: sourceCounts,
    latency_ms: latencyMs,
    model,
    user_status: null,
    user_note: null,
    resolved_at: null,
  };

  const { data: upserted, error } = await supabase
    .from("reverse_briefs")
    .upsert(upsertRow, { onConflict: "user_id,brief_date" })
    .select("id, brief_date, implicit_beliefs, summary, conflicts, source_summary, source_counts, latency_ms, model, user_status, user_note, resolved_at, pinned, archived_at, created_at")
    .single();
  if (error || !upserted) return NextResponse.json({ error: error?.message ?? "upsert failed" }, { status: 500 });

  return NextResponse.json({ reverse_brief: upserted });
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "open";
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.max(1, Math.min(100, isNaN(limitRaw) ? 30 : limitRaw));

  let q = supabase
    .from("reverse_briefs")
    .select("id, brief_date, implicit_beliefs, summary, conflicts, source_summary, source_counts, latency_ms, model, user_status, user_note, resolved_at, pinned, archived_at, created_at")
    .eq("user_id", user.id);

  if (status === "open") q = q.is("user_status", null).is("archived_at", null);
  else if (status === "acknowledged") q = q.eq("user_status", "acknowledged");
  else if (status === "contested") q = q.eq("user_status", "contested");
  else if (status === "dismissed") q = q.eq("user_status", "dismissed");
  else if (status === "resolved") q = q.not("user_status", "is", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);

  q = q.order("brief_date", { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ reverse_briefs: data ?? [] });
}
