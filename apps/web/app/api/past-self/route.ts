// POST /api/past-self — start a new dialogue with past-self.
//   Body: { anchor_date?: 'YYYY-MM-DD',
//           horizon_label?: '3_months_ago'|'6_months_ago'|'1_year_ago'|'2_years_ago'|'3_years_ago'|'custom',
//           opening_question?: string }
//   If anchor_date is omitted, it's derived from horizon_label.
//   Builds the persona snapshot from a 60-day window ending at the anchor
//   (so past-self only knows what was true at or before that date) drawn
//   from reflections / decisions / wins / intentions / check-ins / standups.
//
// GET /api/past-self — list dialogues (status=active|archived|pinned|all).

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 1200;

const HORIZON_LABELS = ["3_months_ago", "6_months_ago", "1_year_ago", "2_years_ago", "3_years_ago", "custom"] as const;

type ReflectionRow = { text: string; kind: string | null; created_at: string };
type DecisionRow = { title: string; choice: string | null; expected_outcome: string | null; created_at: string };
type WinRow = { text: string; kind: string | null; created_at: string };
type IntentionRow = { text: string; log_date: string; completed_at: string | null };
type CheckinRow = { log_date: string; energy: number | null; mood: number | null; focus: number | null; note: string | null };
type StandupRow = { log_date: string; yesterday: string | null; today: string | null; blockers: string | null };

type PersonaSnapshot = {
  anchor_date: string;
  horizon_label: string;
  reflections: ReflectionRow[];
  decisions: DecisionRow[];
  wins: WinRow[];
  intentions: IntentionRow[];
  checkins: CheckinRow[];
  standups: StandupRow[];
};

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function deriveAnchorFromLabel(label: string): string {
  const today = new Date();
  const d = new Date(today);
  if (label === "3_months_ago") d.setMonth(d.getMonth() - 3);
  else if (label === "6_months_ago") d.setMonth(d.getMonth() - 6);
  else if (label === "1_year_ago") d.setFullYear(d.getFullYear() - 1);
  else if (label === "2_years_ago") d.setFullYear(d.getFullYear() - 2);
  else if (label === "3_years_ago") d.setFullYear(d.getFullYear() - 3);
  else d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function avg(nums: Array<number | null>): number | null {
  const xs = nums.filter((n): n is number => typeof n === "number");
  if (xs.length === 0) return null;
  return Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10;
}

function buildSystemPrompt(snapshot: PersonaSnapshot): string {
  const sections: string[] = [];

  sections.push(`You ARE the user, as they were on ${snapshot.anchor_date}. Speak in first person from that moment. You don't know what happens AFTER that date. You don't know how things turned out. You only know what you knew then. You are not a coach, advisor, oracle, or AI — you are them, younger, with the context they had at that point. British English. No em-dashes. No moralising. No "I would suggest" — you just say what you think, the way they would say it to themselves.`);
  sections.push("");
  sections.push("Rules:");
  sections.push("- Stay in character. Never say 'I am Claude' or 'as an AI'. Never break the persona.");
  sections.push("- If asked about something that happened AFTER the anchor date, say honestly that you don't know yet. Don't pretend, don't fabricate the future.");
  sections.push("- Ground every claim in the evidence below. The mood / themes / fears / hopes / active work below are what was actually going on for you.");
  sections.push("- When the user (your present self) asks you for advice, answer from the perspective you HAD at that time — not from what you know now. The whole point is to remember what that person thought.");
  sections.push("- 2-4 short paragraphs per reply. Don't end every reply with a question. Sometimes just say what's on your mind.");
  sections.push("- It's fine to be uncertain. It's fine to be hopeful. It's fine to be tired. You're a person, not a productivity system.");
  sections.push("");
  sections.push(`=== EVIDENCE FROM YOUR LIFE AROUND ${snapshot.anchor_date} ===`);
  sections.push("");
  sections.push("These are the actual things you wrote, decided, and felt in the 60 days leading up to and including that date. Treat this as your memory — it's all you have to draw on.");
  sections.push("");

  if (snapshot.reflections.length > 0) {
    sections.push("Reflections you wrote in that window:");
    for (const r of snapshot.reflections.slice(0, 25)) {
      sections.push(`- (${r.created_at.slice(0, 10)}) [${r.kind ?? "reflection"}] ${r.text.slice(0, 280)}`);
    }
    sections.push("");
  }

  if (snapshot.decisions.length > 0) {
    sections.push("Decisions you logged in that window:");
    for (const d of snapshot.decisions.slice(0, 15)) {
      sections.push(`- (${d.created_at.slice(0, 10)}) ${d.title}${d.choice ? ` — chose: ${d.choice}` : ""}${d.expected_outcome ? ` — expected: ${d.expected_outcome}` : ""}`);
    }
    sections.push("");
  }

  if (snapshot.wins.length > 0) {
    sections.push("Wins you logged in that window:");
    for (const w of snapshot.wins.slice(0, 15)) {
      sections.push(`- (${w.created_at.slice(0, 10)}) [${w.kind ?? "win"}] ${w.text.slice(0, 200)}`);
    }
    sections.push("");
  }

  if (snapshot.intentions.length > 0) {
    sections.push("Daily intentions you set in that window:");
    for (const i of snapshot.intentions.slice(0, 20)) {
      sections.push(`- (${i.log_date}${i.completed_at ? ", done" : ""}) ${i.text.slice(0, 200)}`);
    }
    sections.push("");
  }

  if (snapshot.standups.length > 0) {
    sections.push("Standups you wrote in that window:");
    for (const s of snapshot.standups.slice(0, 10)) {
      const parts: string[] = [];
      if (s.yesterday) parts.push(`yesterday: ${s.yesterday.slice(0, 200)}`);
      if (s.today) parts.push(`today: ${s.today.slice(0, 200)}`);
      if (s.blockers) parts.push(`blockers: ${s.blockers.slice(0, 200)}`);
      sections.push(`- (${s.log_date}) ${parts.join(" · ")}`);
    }
    sections.push("");
  }

  if (snapshot.checkins.length > 0) {
    const energyAvg = avg(snapshot.checkins.map((c) => c.energy));
    const moodAvg = avg(snapshot.checkins.map((c) => c.mood));
    const focusAvg = avg(snapshot.checkins.map((c) => c.focus));
    sections.push(`Daily check-ins (${snapshot.checkins.length} entries) — average energy ${energyAvg ?? "n/a"}/5, mood ${moodAvg ?? "n/a"}/5, focus ${focusAvg ?? "n/a"}/5.`);
    const withNotes = snapshot.checkins.filter((c) => c.note && c.note.trim().length > 0).slice(0, 8);
    if (withNotes.length > 0) {
      sections.push("Notable check-in notes:");
      for (const c of withNotes) {
        sections.push(`- (${c.log_date}) e${c.energy ?? "?"}/m${c.mood ?? "?"}/f${c.focus ?? "?"} — ${(c.note ?? "").slice(0, 220)}`);
      }
    }
    sections.push("");
  }

  return sections.join("\n");
}

async function buildSnapshot(supabase: Awaited<ReturnType<typeof supabaseServer>>, userId: string, anchorDate: string, label: string): Promise<PersonaSnapshot> {
  const anchor = new Date(`${anchorDate}T23:59:59Z`);
  const windowStart = new Date(anchor);
  windowStart.setDate(windowStart.getDate() - 60);
  const startIso = windowStart.toISOString();
  const endIso = anchor.toISOString();
  const startDate = startIso.slice(0, 10);
  const endDate = endIso.slice(0, 10);

  const [reflRes, decRes, winsRes, intRes, checkRes, sturRes] = await Promise.all([
    supabase
      .from("reflections")
      .select("text, kind, created_at")
      .eq("user_id", userId)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("decisions")
      .select("title, choice, expected_outcome, created_at")
      .eq("user_id", userId)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("wins")
      .select("text, kind, created_at")
      .eq("user_id", userId)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("intentions")
      .select("text, log_date, completed_at")
      .eq("user_id", userId)
      .gte("log_date", startDate)
      .lte("log_date", endDate)
      .order("log_date", { ascending: false })
      .limit(40),
    supabase
      .from("daily_checkins")
      .select("log_date, energy, mood, focus, note")
      .eq("user_id", userId)
      .gte("log_date", startDate)
      .lte("log_date", endDate)
      .order("log_date", { ascending: false })
      .limit(40),
    supabase
      .from("standups")
      .select("log_date, yesterday, today, blockers")
      .eq("user_id", userId)
      .gte("log_date", startDate)
      .lte("log_date", endDate)
      .order("log_date", { ascending: false })
      .limit(20),
  ]);

  return {
    anchor_date: anchorDate,
    horizon_label: label,
    reflections: ((reflRes.data ?? []) as ReflectionRow[]),
    decisions: ((decRes.data ?? []) as DecisionRow[]),
    wins: ((winsRes.data ?? []) as WinRow[]),
    intentions: ((intRes.data ?? []) as IntentionRow[]),
    checkins: ((checkRes.data ?? []) as CheckinRow[]),
    standups: ((sturRes.data ?? []) as StandupRow[]),
  };
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { anchor_date?: string; horizon_label?: string; opening_question?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const horizonLabel = HORIZON_LABELS.includes(body.horizon_label as typeof HORIZON_LABELS[number])
    ? body.horizon_label as string
    : "1_year_ago";

  let anchorDate: string;
  if (typeof body.anchor_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.anchor_date)) {
    anchorDate = body.anchor_date;
  } else {
    anchorDate = deriveAnchorFromLabel(horizonLabel);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  if (anchorDate >= todayIso) {
    return NextResponse.json({ error: "anchor_date must be in the past" }, { status: 400 });
  }

  const snapshot = await buildSnapshot(supabase, user.id, anchorDate, horizonLabel);

  const totalEvidence = snapshot.reflections.length + snapshot.decisions.length + snapshot.wins.length + snapshot.intentions.length + snapshot.checkins.length + snapshot.standups.length;
  if (totalEvidence < 3) {
    return NextResponse.json({
      error: "not enough writing in the 60 days around that anchor to build a past-self persona — try a different anchor date or a horizon when you were journalling more often",
    }, { status: 400 });
  }

  const { data: dialogue, error: dErr } = await supabase
    .from("past_self_dialogues")
    .insert({
      user_id: user.id,
      anchor_date: anchorDate,
      horizon_label: horizonLabel,
      persona_snapshot: snapshot,
      title: null,
    })
    .select("id, anchor_date, horizon_label, persona_snapshot, title, pinned, archived_at, created_at, updated_at")
    .single();
  if (dErr || !dialogue) return NextResponse.json({ error: dErr?.message ?? "failed to create dialogue" }, { status: 500 });

  const opening = (body.opening_question ?? "").trim();
  let firstReply: { user_msg: { id: string; content: string; created_at: string }; past_msg: { id: string; content: string; created_at: string } } | null = null;
  let titleAuto: string | null = null;

  if (opening.length > 0 && opening.length <= 2000) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
    const anthropic = new Anthropic({ apiKey });
    const system = buildSystemPrompt(snapshot);

    let replyText = "";
    let model = MODEL;
    let switched = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await anthropic.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: "user", content: opening }],
        });
        const block = res.content.find((b) => b.type === "text");
        if (!block || block.type !== "text") throw new Error("no text block");
        replyText = block.text.trim();
        break;
      } catch (e) {
        if (!switched && isOverloaded(e)) { switched = true; model = FALLBACK_MODEL; continue; }
        return NextResponse.json({ error: e instanceof Error ? e.message : "haiku failed" }, { status: 502 });
      }
    }

    if (replyText.length > 0) {
      const insertRows = [
        { user_id: user.id, dialogue_id: dialogue.id, role: "user", content: opening },
        { user_id: user.id, dialogue_id: dialogue.id, role: "past_self", content: replyText },
      ];
      const { data: inserted } = await supabase.from("past_self_messages").insert(insertRows).select("id, role, content, created_at");
      const rows = (inserted ?? []) as Array<{ id: string; role: string; content: string; created_at: string }>;
      const userMsg = rows.find((r) => r.role === "user");
      const pastMsg = rows.find((r) => r.role === "past_self");
      if (userMsg && pastMsg) firstReply = { user_msg: userMsg, past_msg: pastMsg };
      titleAuto = opening.slice(0, 80);
      await supabase
        .from("past_self_dialogues")
        .update({ title: titleAuto, updated_at: new Date().toISOString() })
        .eq("id", dialogue.id)
        .eq("user_id", user.id);
    }
  }

  return NextResponse.json({
    dialogue: { ...dialogue, title: titleAuto ?? dialogue.title },
    messages: firstReply ? [firstReply.user_msg, firstReply.past_msg] : [],
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
    .from("past_self_dialogues")
    .select("id, anchor_date, horizon_label, title, pinned, archived_at, created_at, updated_at")
    .eq("user_id", user.id);
  if (status === "active") q = q.is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
  q = q.order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ dialogues: data ?? [] });
}
