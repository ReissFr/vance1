// POST /api/past-self/[id]/message — append a user message and get the
// past-self reply. Builds the conversation history from prior messages
// and re-uses the dialogue's frozen persona_snapshot as the system prompt
// anchor (so even if the user's writing has changed since the dialogue
// was created, the past-self stays consistent with that moment).

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 1200;
const HISTORY_LIMIT = 40;

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

function avg(nums: Array<number | null>): number | null {
  const xs = nums.filter((n): n is number => typeof n === "number");
  if (xs.length === 0) return null;
  return Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10;
}

function buildSystemPrompt(snapshot: PersonaSnapshot): string {
  const sections: string[] = [];
  sections.push(`You ARE the user, as they were on ${snapshot.anchor_date}. Speak in first person from that moment. You don't know what happens AFTER that date. You only know what you knew then. You are not a coach, advisor, oracle, or AI — you are them, younger. British English. No em-dashes. No moralising.`);
  sections.push("");
  sections.push("Rules:");
  sections.push("- Stay in character. Never say 'I am Claude' or 'as an AI'. Never break the persona.");
  sections.push("- If asked about something that happened AFTER the anchor date, say honestly that you don't know yet. Don't fabricate the future.");
  sections.push("- Ground every claim in the evidence below. Don't invent.");
  sections.push("- When the user (your present self) asks for advice, answer from the perspective you HAD at that time.");
  sections.push("- 2-4 short paragraphs per reply. Don't end every reply with a question.");
  sections.push("- It's fine to be uncertain. It's fine to be hopeful. It's fine to be tired.");
  sections.push("");
  sections.push(`=== EVIDENCE FROM YOUR LIFE AROUND ${snapshot.anchor_date} ===`);
  sections.push("");

  if ((snapshot.reflections ?? []).length > 0) {
    sections.push("Reflections you wrote in that window:");
    for (const r of snapshot.reflections.slice(0, 25)) {
      sections.push(`- (${r.created_at.slice(0, 10)}) [${r.kind ?? "reflection"}] ${r.text.slice(0, 280)}`);
    }
    sections.push("");
  }
  if ((snapshot.decisions ?? []).length > 0) {
    sections.push("Decisions you logged:");
    for (const d of snapshot.decisions.slice(0, 15)) {
      sections.push(`- (${d.created_at.slice(0, 10)}) ${d.title}${d.choice ? ` — chose: ${d.choice}` : ""}${d.expected_outcome ? ` — expected: ${d.expected_outcome}` : ""}`);
    }
    sections.push("");
  }
  if ((snapshot.wins ?? []).length > 0) {
    sections.push("Wins you logged:");
    for (const w of snapshot.wins.slice(0, 15)) {
      sections.push(`- (${w.created_at.slice(0, 10)}) [${w.kind ?? "win"}] ${w.text.slice(0, 200)}`);
    }
    sections.push("");
  }
  if ((snapshot.intentions ?? []).length > 0) {
    sections.push("Daily intentions:");
    for (const i of snapshot.intentions.slice(0, 20)) {
      sections.push(`- (${i.log_date}${i.completed_at ? ", done" : ""}) ${i.text.slice(0, 200)}`);
    }
    sections.push("");
  }
  if ((snapshot.standups ?? []).length > 0) {
    sections.push("Standups:");
    for (const s of snapshot.standups.slice(0, 10)) {
      const parts: string[] = [];
      if (s.yesterday) parts.push(`yesterday: ${s.yesterday.slice(0, 200)}`);
      if (s.today) parts.push(`today: ${s.today.slice(0, 200)}`);
      if (s.blockers) parts.push(`blockers: ${s.blockers.slice(0, 200)}`);
      sections.push(`- (${s.log_date}) ${parts.join(" · ")}`);
    }
    sections.push("");
  }
  if ((snapshot.checkins ?? []).length > 0) {
    const energyAvg = avg(snapshot.checkins.map((c) => c.energy));
    const moodAvg = avg(snapshot.checkins.map((c) => c.mood));
    const focusAvg = avg(snapshot.checkins.map((c) => c.focus));
    sections.push(`Daily check-ins (${snapshot.checkins.length}) — avg energy ${energyAvg ?? "n/a"}/5, mood ${moodAvg ?? "n/a"}/5, focus ${focusAvg ?? "n/a"}/5.`);
    const withNotes = snapshot.checkins.filter((c) => c.note && c.note.trim().length > 0).slice(0, 6);
    if (withNotes.length > 0) {
      sections.push("Notable notes:");
      for (const c of withNotes) {
        sections.push(`- (${c.log_date}) e${c.energy ?? "?"}/m${c.mood ?? "?"}/f${c.focus ?? "?"} — ${(c.note ?? "").slice(0, 200)}`);
      }
    }
    sections.push("");
  }

  return sections.join("\n");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: dialogueId } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { content?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const content = (body.content ?? "").trim();
  if (content.length < 1 || content.length > 4000) {
    return NextResponse.json({ error: "content must be 1-4000 chars" }, { status: 400 });
  }

  const { data: dialogue, error: dErr } = await supabase
    .from("past_self_dialogues")
    .select("id, anchor_date, horizon_label, persona_snapshot")
    .eq("id", dialogueId)
    .eq("user_id", user.id)
    .single();
  if (dErr || !dialogue) return NextResponse.json({ error: "dialogue not found" }, { status: 404 });

  const snapshot = (dialogue as { persona_snapshot: PersonaSnapshot }).persona_snapshot;

  const { data: history } = await supabase
    .from("past_self_messages")
    .select("role, content, created_at")
    .eq("dialogue_id", dialogueId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(HISTORY_LIMIT);

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of (history ?? []) as Array<{ role: string; content: string }>) {
    messages.push({ role: m.role === "user" ? "user" : "assistant", content: m.content });
  }
  messages.push({ role: "user", content });

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
        messages,
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

  if (replyText.length === 0) return NextResponse.json({ error: "empty reply" }, { status: 502 });

  const inserts = [
    { user_id: user.id, dialogue_id: dialogueId, role: "user", content },
    { user_id: user.id, dialogue_id: dialogueId, role: "past_self", content: replyText },
  ];
  const { data: inserted, error: iErr } = await supabase
    .from("past_self_messages")
    .insert(inserts)
    .select("id, role, content, created_at");
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  await supabase
    .from("past_self_dialogues")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", dialogueId)
    .eq("user_id", user.id);

  return NextResponse.json({ messages: inserted ?? [] });
}
