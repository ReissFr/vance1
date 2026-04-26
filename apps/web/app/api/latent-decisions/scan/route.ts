// POST /api/latent-decisions/scan — compare two windows of evidence and
// surface decisions the user has MADE BY DEFAULT (stopped doing,
// dropped, drifted from). Pulls quantitative deltas from
// people-interactions / habits / themes / standups / reflections,
// builds a delta dump, and asks Haiku to identify 0-5 LATENT
// DECISIONS each phrased as a one-sentence reframe in the user's voice.
//
// Body: { window_old_start_days?: 60-365 (default 180), window_old_end_days?: 30-180 (default 90), window_new_days?: 14-90 (default 30) }
//
// The scan is idempotent in spirit — running back-to-back with similar
// windows will mostly produce the same candidates. The dedup is naive:
// any open (user_status = null) row with the same (kind, label) blocks
// a new candidate from being inserted.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 2000;

const VALID_KINDS = new Set(["person", "theme", "habit", "routine", "topic", "practice", "place", "identity", "other"]);

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function dateOnly(iso: string): string { return iso.slice(0, 10); }

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { window_old_start_days?: number; window_old_end_days?: number; window_new_days?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const oldStartDays = Math.max(60, Math.min(365, Math.round(body.window_old_start_days ?? 180)));
  let oldEndDays = Math.max(30, Math.min(180, Math.round(body.window_old_end_days ?? 90)));
  const newDays = Math.max(14, Math.min(90, Math.round(body.window_new_days ?? 30)));
  if (oldEndDays >= oldStartDays) oldEndDays = Math.max(30, oldStartDays - 30);
  if (oldEndDays < newDays) oldEndDays = newDays;

  const t0 = Date.now();
  const now = Date.now();
  const oldStartIso = new Date(now - oldStartDays * 86_400_000).toISOString();
  const oldEndIso = new Date(now - oldEndDays * 86_400_000).toISOString();
  const newStartIso = new Date(now - newDays * 86_400_000).toISOString();
  const oldStartDate = dateOnly(oldStartIso);
  const oldEndDate = dateOnly(oldEndIso);
  const newStartDate = dateOnly(newStartIso);
  const todayDate = dateOnly(new Date().toISOString());

  // Pull data across both windows
  const [
    peopleRes,
    interactionsOldRes,
    interactionsNewRes,
    themesRes,
    habitsRes,
    habitLogsOldRes,
    habitLogsNewRes,
    refsOldRes,
    refsNewRes,
    standupsOldRes,
    standupsNewRes,
    decsRes,
  ] = await Promise.all([
    supabase.from("people").select("id, name, relation, importance, last_interaction_at").eq("user_id", user.id).is("archived_at", null).order("importance", { ascending: false }).limit(60),
    supabase.from("person_interactions").select("person_id, kind, occurred_at").eq("user_id", user.id).gte("occurred_at", oldStartIso).lt("occurred_at", oldEndIso).limit(300),
    supabase.from("person_interactions").select("person_id, kind, occurred_at").eq("user_id", user.id).gte("occurred_at", newStartIso).limit(200),
    supabase.from("themes").select("id, title, status, current_state, updated_at, created_at").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(30),
    supabase.from("habits").select("id, name, cadence, target_per_week").eq("user_id", user.id).is("archived_at", null).limit(40),
    supabase.from("habit_logs").select("habit_id, log_date").eq("user_id", user.id).gte("log_date", oldStartDate).lt("log_date", oldEndDate).limit(800),
    supabase.from("habit_logs").select("habit_id, log_date").eq("user_id", user.id).gte("log_date", newStartDate).limit(400),
    supabase.from("reflections").select("id, text, kind, created_at").eq("user_id", user.id).gte("created_at", oldStartIso).lt("created_at", oldEndIso).order("created_at", { ascending: false }).limit(40),
    supabase.from("reflections").select("id, text, kind, created_at").eq("user_id", user.id).gte("created_at", newStartIso).order("created_at", { ascending: false }).limit(40),
    supabase.from("standups").select("today, blockers, log_date").eq("user_id", user.id).gte("log_date", oldStartDate).lt("log_date", oldEndDate).limit(60),
    supabase.from("standups").select("today, blockers, log_date").eq("user_id", user.id).gte("log_date", newStartDate).limit(40),
    supabase.from("decisions").select("title, choice, tags, created_at").eq("user_id", user.id).gte("created_at", oldStartIso).order("created_at", { ascending: false }).limit(40),
  ]);

  const people = (peopleRes.data ?? []) as Array<{ id: string; name: string; relation: string; importance: number; last_interaction_at: string | null }>;
  const intsOld = (interactionsOldRes.data ?? []) as Array<{ person_id: string; kind: string; occurred_at: string }>;
  const intsNew = (interactionsNewRes.data ?? []) as Array<{ person_id: string; kind: string; occurred_at: string }>;
  const themes = (themesRes.data ?? []) as Array<{ id: string; title: string; status: string; current_state: string | null; updated_at: string; created_at: string }>;
  const habits = (habitsRes.data ?? []) as Array<{ id: string; name: string; cadence: string; target_per_week: number }>;
  const habLogsOld = (habitLogsOldRes.data ?? []) as Array<{ habit_id: string; log_date: string }>;
  const habLogsNew = (habitLogsNewRes.data ?? []) as Array<{ habit_id: string; log_date: string }>;
  const refsOld = (refsOldRes.data ?? []) as Array<{ id: string; text: string; kind: string; created_at: string }>;
  const refsNew = (refsNewRes.data ?? []) as Array<{ id: string; text: string; kind: string; created_at: string }>;
  const stdOld = (standupsOldRes.data ?? []) as Array<{ today: string | null; blockers: string | null; log_date: string }>;
  const stdNew = (standupsNewRes.data ?? []) as Array<{ today: string | null; blockers: string | null; log_date: string }>;
  const decs = (decsRes.data ?? []) as Array<{ title: string; choice: string | null; tags: string[] | null; created_at: string }>;

  if (people.length + themes.length + habits.length + refsOld.length + refsNew.length + stdOld.length + stdNew.length < 12) {
    return NextResponse.json({ error: "not enough activity to scan for latent decisions yet — log a few weeks of journal entries first" }, { status: 400 });
  }

  // Quantitative deltas
  const oldWindowDays = Math.max(1, oldStartDays - oldEndDays);

  const intsOldByPerson = new Map<string, number>();
  for (const i of intsOld) intsOldByPerson.set(i.person_id, (intsOldByPerson.get(i.person_id) ?? 0) + 1);
  const intsNewByPerson = new Map<string, number>();
  for (const i of intsNew) intsNewByPerson.set(i.person_id, (intsNewByPerson.get(i.person_id) ?? 0) + 1);

  type PersonDrop = { name: string; relation: string; importance: number; old_count: number; new_count: number; old_per_30d: number; new_per_30d: number };
  const personDrops: PersonDrop[] = [];
  for (const p of people) {
    const oldCount = intsOldByPerson.get(p.id) ?? 0;
    const newCount = intsNewByPerson.get(p.id) ?? 0;
    const oldPer30 = (oldCount / oldWindowDays) * 30;
    const newPer30 = (newCount / Math.max(1, newDays)) * 30;
    if (oldPer30 >= 1 && newPer30 < oldPer30 * 0.4) {
      personDrops.push({ name: p.name, relation: p.relation, importance: p.importance, old_count: oldCount, new_count: newCount, old_per_30d: Math.round(oldPer30 * 10) / 10, new_per_30d: Math.round(newPer30 * 10) / 10 });
    }
  }
  personDrops.sort((a, b) => (b.importance - a.importance) || (b.old_per_30d - a.old_per_30d));

  const habLogsOldByHabit = new Map<string, number>();
  for (const l of habLogsOld) habLogsOldByHabit.set(l.habit_id, (habLogsOldByHabit.get(l.habit_id) ?? 0) + 1);
  const habLogsNewByHabit = new Map<string, number>();
  for (const l of habLogsNew) habLogsNewByHabit.set(l.habit_id, (habLogsNewByHabit.get(l.habit_id) ?? 0) + 1);

  type HabitDrop = { name: string; cadence: string; target_per_week: number; old_per_week: number; new_per_week: number };
  const habitDrops: HabitDrop[] = [];
  for (const h of habits) {
    const oldCount = habLogsOldByHabit.get(h.id) ?? 0;
    const newCount = habLogsNewByHabit.get(h.id) ?? 0;
    const oldPerWeek = (oldCount / oldWindowDays) * 7;
    const newPerWeek = (newCount / Math.max(1, newDays)) * 7;
    if (oldPerWeek >= 1 && newPerWeek < oldPerWeek * 0.4) {
      habitDrops.push({ name: h.name, cadence: h.cadence, target_per_week: h.target_per_week, old_per_week: Math.round(oldPerWeek * 10) / 10, new_per_week: Math.round(newPerWeek * 10) / 10 });
    }
  }
  habitDrops.sort((a, b) => b.old_per_week - a.old_per_week);

  type ThemeDecline = { title: string; status: string; updated_age_days: number; current_state: string | null };
  const themeDeclines: ThemeDecline[] = [];
  for (const t of themes) {
    if (t.status === "closed") continue;
    const ageDays = (Date.now() - new Date(t.updated_at).getTime()) / 86_400_000;
    if (ageDays > newDays * 1.5) {
      themeDeclines.push({ title: t.title, status: t.status, updated_age_days: Math.round(ageDays), current_state: t.current_state });
    }
  }
  themeDeclines.sort((a, b) => a.updated_age_days - b.updated_age_days);

  // Build evidence dump
  const lines: string[] = [];
  lines.push(`OLDER WINDOW: ${oldStartDate} → ${oldEndDate} (${oldWindowDays} days, "the past")`);
  lines.push(`NEWER WINDOW: ${newStartDate} → ${todayDate} (${newDays} days, "now")`);
  lines.push("");

  if (personDrops.length) {
    lines.push("PEOPLE — interaction-frequency drops (per 30d, old → new):");
    for (const pd of personDrops.slice(0, 10)) lines.push(`- ${pd.name} [${pd.relation}, importance ${pd.importance}]: ${pd.old_per_30d}/30d → ${pd.new_per_30d}/30d (${pd.old_count} interactions then, ${pd.new_count} now)`);
    lines.push("");
  }

  if (habitDrops.length) {
    lines.push("HABITS — logging-frequency drops (per week, old → new):");
    for (const hd of habitDrops.slice(0, 10)) lines.push(`- "${hd.name}" [${hd.cadence}, target ${hd.target_per_week}/wk]: ${hd.old_per_week}/wk → ${hd.new_per_week}/wk`);
    lines.push("");
  }

  if (themeDeclines.length) {
    lines.push("THEMES — active themes that haven't been touched in a while:");
    for (const td of themeDeclines.slice(0, 8)) lines.push(`- "${td.title}" [${td.status}]: not updated for ${td.updated_age_days} days${td.current_state ? ` — last state: ${td.current_state.slice(0, 120)}` : ""}`);
    lines.push("");
  }

  if (refsOld.length) {
    lines.push(`REFLECTIONS FROM THE OLDER WINDOW (sample of ${Math.min(refsOld.length, 12)}):`);
    for (const r of refsOld.slice(0, 12)) lines.push(`- ${dateOnly(r.created_at)} [${r.kind}] ${r.text.slice(0, 200)}`);
    lines.push("");
  }
  if (refsNew.length) {
    lines.push(`REFLECTIONS FROM THE NEWER WINDOW (sample of ${Math.min(refsNew.length, 12)}):`);
    for (const r of refsNew.slice(0, 12)) lines.push(`- ${dateOnly(r.created_at)} [${r.kind}] ${r.text.slice(0, 200)}`);
    lines.push("");
  }

  if (stdOld.length) {
    lines.push(`STANDUP-TODAY FROM THE OLDER WINDOW (last 6):`);
    for (const s of stdOld.slice(0, 6)) if (s.today) lines.push(`- ${s.log_date} ${s.today.slice(0, 160)}`);
    lines.push("");
  }
  if (stdNew.length) {
    lines.push(`STANDUP-TODAY FROM THE NEWER WINDOW (last 6):`);
    for (const s of stdNew.slice(0, 6)) if (s.today) lines.push(`- ${s.log_date} ${s.today.slice(0, 160)}`);
    lines.push("");
  }

  if (decs.length) {
    lines.push("RECENT EXPLICIT DECISIONS (so you don't double-count what was already chosen consciously):");
    for (const d of decs.slice(0, 12)) lines.push(`- ${dateOnly(d.created_at)} ${d.title}${d.choice ? " — " + d.choice.slice(0, 100) : ""}`);
    lines.push("");
  }

  const system = [
    "You are detecting LATENT DECISIONS — choices the user has MADE BY DEFAULT but never explicitly logged. The user has stopped, dropped, or drifted from things their actions used to include.",
    "",
    "Output strict JSON ONLY:",
    `{"latent": [{"kind": "...", "label": "...", "candidate_decision": "...", "evidence_summary": "...", "strength": 1-5, "source_signal": "..."}, ...]}`,
    "",
    "Rules:",
    "- Return 0-5 latent decisions. ZERO is fine. Don't pad. Only surface things that are actually load-bearing — a habit dropped for 1 week isn't a decision; a habit dropped for 6 weeks where the user used to do it 4x/wk IS.",
    "- kind: one of person | theme | habit | routine | topic | practice | place | identity | other.",
    "- label: 2-5 word short label of what dropped (e.g. 'Daily running', 'Friendship with Marcus', 'Agency project Q4', 'Lisbon house-hunt').",
    "- candidate_decision: ONE sentence in second-person voice naming the latent decision the user has effectively made (e.g. 'You've decided to stop running.', 'You've decided to let the Marcus friendship drift.', 'You've decided to wind down the Q4 agency project.'). NOT 'maybe you've...' — state it. The user can contest it.",
    "- evidence_summary: ONE factual sentence summarising the quantitative drop or qualitative shift ('logged 4x/week through Q3, dropped to 0/week in the last 30 days', 'used to mention Marcus in 6 reflections last quarter, zero in the new window').",
    "- strength: 1-5 — how stark the drop is. 5 = ironclad (was core to identity, now invisible); 1 = soft signal worth checking.",
    "- source_signal: which data fed it ('interactions_drop', 'habit_logging_drop', 'theme_decline', 'reflection_topic_shift', 'llm_synthesis').",
    "",
    "DO NOT surface things the user has already EXPLICITLY decided (cross-reference RECENT EXPLICIT DECISIONS).",
    "DO NOT surface things still present in the newer window — only things that have actually dropped/disappeared.",
    "DO NOT moralise. Don't suggest the user 'should' restart something — just NAME the latent decision.",
    "DO NOT invent. Stick to what the evidence supports.",
    "",
    "Voice: British English, no em-dashes, no hedging, no clichés, no advice. Just NAME what's happened.",
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

  let parsed: { latent?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.latent)) {
    return NextResponse.json({ error: "model output missing latent array" }, { status: 502 });
  }

  // Pull existing OPEN candidates for dedup
  const { data: existingOpen } = await supabase
    .from("latent_decisions")
    .select("kind, label")
    .eq("user_id", user.id)
    .is("user_status", null)
    .is("archived_at", null);
  const existingSet = new Set((existingOpen ?? []).map((r) => `${(r as { kind: string }).kind}::${((r as { label: string }).label ?? "").toLowerCase().trim()}`));

  type Parsed = { kind?: unknown; label?: unknown; candidate_decision?: unknown; evidence_summary?: unknown; strength?: unknown; source_signal?: unknown };
  const scanId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const latencyMs = Date.now() - t0;

  const toInsert: Array<{
    user_id: string;
    scan_id: string;
    kind: string;
    label: string;
    candidate_decision: string;
    evidence_summary: string | null;
    strength: number;
    source_signal: string | null;
    latency_ms: number;
    model: string;
  }> = [];

  for (const c of parsed.latent as Parsed[]) {
    const kind = typeof c.kind === "string" && VALID_KINDS.has(c.kind) ? c.kind : null;
    const label = typeof c.label === "string" ? c.label.trim().slice(0, 80) : "";
    const cand = typeof c.candidate_decision === "string" ? c.candidate_decision.trim().slice(0, 240) : "";
    const evid = typeof c.evidence_summary === "string" ? c.evidence_summary.trim().slice(0, 400) : null;
    const strength = typeof c.strength === "number" ? Math.max(1, Math.min(5, Math.round(c.strength))) : null;
    const signal = typeof c.source_signal === "string" ? c.source_signal.trim().slice(0, 60) : null;
    if (!kind || !label || cand.length < 8 || !strength) continue;
    const dedupKey = `${kind}::${label.toLowerCase().trim()}`;
    if (existingSet.has(dedupKey)) continue;
    existingSet.add(dedupKey);
    toInsert.push({
      user_id: user.id,
      scan_id: scanId,
      kind,
      label,
      candidate_decision: cand,
      evidence_summary: evid,
      strength,
      source_signal: signal,
      latency_ms: latencyMs,
      model,
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, scan_id: scanId, inserted: 0, message: "no new latent decisions detected this scan", latency_ms: latencyMs });
  }

  const { data: inserted, error } = await supabase
    .from("latent_decisions")
    .insert(toInsert)
    .select("id, scan_id, kind, label, candidate_decision, evidence_summary, strength, source_signal, user_status, user_note, resulting_decision_id, pinned, archived_at, resolved_at, latency_ms, model, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: inserted?.length ?? 0,
    latent_decisions: inserted ?? [],
    latency_ms: latencyMs,
    signals: {
      person_drops: personDrops.length,
      habit_drops: habitDrops.length,
      theme_declines: themeDeclines.length,
    },
  });
}
