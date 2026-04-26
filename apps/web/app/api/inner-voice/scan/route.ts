// POST /api/inner-voice/scan — Inner Voice Atlas (§157).
//
// Body: { window_days?: 14-365 (default 90) }
//
// Mines the user's own messages, classifies each piece of self-talk into one
// of ten VOICES (the WHO inside the user that is speaking), produces a scan
// summary (dominant voices + counts + a 2-3 sentence atlas_narrative) and
// inserts each utterance.
//
// VOICES:
//   critic       — self-judgement ("I'm being lazy", "I should know better")
//   dreamer      — vision, ambition ("I want to build...", "imagine if...")
//   calculator   — reasoning, plans ("the math is", "if X then Y")
//   frightened   — fear, anxiety ("I'm worried", "what if it fails")
//   soldier      — discipline, grind ("just push through", "no excuses")
//   philosopher  — meaning, reflection ("what does this even mean")
//   victim       — blame, helplessness ("this always happens", "nothing works")
//   coach        — encouragement ("you've got this", "break it down")
//   comedian     — deflection through humour
//   scholar      — curiosity, learning ("interesting that X", "I wonder why")

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 4200;

const VALID_VOICES = new Set([
  "critic", "dreamer", "calculator", "frightened", "soldier",
  "philosopher", "victim", "coach", "comedian", "scholar",
]);

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

  let body: { window_days?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const windowDays = Math.max(14, Math.min(365, Math.round(body.window_days ?? 90)));

  const t0 = Date.now();
  const startIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const todayDate = dateOnly(new Date().toISOString());
  const startDate = dateOnly(startIso);

  const { data: msgRows, error: msgErr } = await supabase
    .from("messages")
    .select("id, conversation_id, content, created_at")
    .eq("user_id", user.id)
    .eq("role", "user")
    .gte("created_at", startIso)
    .order("created_at", { ascending: false })
    .limit(1200);
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  const messages = (msgRows ?? []) as Array<{ id: string; conversation_id: string; content: string; created_at: string }>;

  if (messages.length < 30) {
    return NextResponse.json({ error: "not enough chat history in the window — try a longer window or come back after more conversations" }, { status: 400 });
  }

  // Pre-filter to messages that contain self-talk markers — first-person
  // reflective language. Skips short commands ("run docker", "what's 2+2").
  const SELF_RE = /\b(i feel|i'?m feeling|i think|i'?m thinking|i'?m worried|i'?m anxious|i'?m tired|i'?m exhausted|i'?m so|i just need|i wish|i should|i shouldn'?t|i can'?t|i don'?t know if|i keep|i always|i never|i want|i love|i hate|maybe i|i guess|the truth is|honestly|let me think|i'?m struggling|i'?m proud|i'?m ashamed|i'?m embarrassed|i'?m scared|i'?m frustrated|i'?m doing|i'?ve been|why am i|why do i|why can'?t i|i suppose|i realise|i realize|i notice|part of me|something in me|deep down|i hope|i'?m hoping|i'?m worth|am i (?:the kind|even|really|just))/i;
  const candidates = messages.filter((m) => SELF_RE.test(m.content) && m.content.length >= 30);

  if (candidates.length < 5) {
    return NextResponse.json({ error: "not enough self-talk in this window — try a longer window" }, { status: 400 });
  }

  const trimmed = candidates.map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    created_at: m.created_at,
    snippet: m.content.length > 380 ? m.content.slice(0, 360) + " ..." : m.content,
  }));

  // Sample if too many — preserve chronological coverage.
  const SAMPLE_LIMIT = 220;
  const sampled: typeof trimmed = [];
  if (trimmed.length <= SAMPLE_LIMIT) {
    sampled.push(...trimmed);
  } else {
    const step = trimmed.length / SAMPLE_LIMIT;
    for (let i = 0; i < SAMPLE_LIMIT; i += 1) {
      const idx = Math.floor(i * step);
      const item = trimmed[idx];
      if (item) sampled.push(item);
    }
  }
  sampled.sort((a, b) => a.created_at.localeCompare(b.created_at));

  const msgDates = new Map<string, string>();
  const msgConvos = new Map<string, string>();
  for (const m of sampled) {
    msgDates.set(m.id, dateOnly(m.created_at));
    msgConvos.set(m.id, m.conversation_id);
  }

  const lines: string[] = [];
  lines.push(`WINDOW: ${startDate} → ${todayDate} (${windowDays} days)`);
  lines.push(`SELF-TALK CANDIDATE MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("CANDIDATE MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are mapping the user's INNER VOICE ATLAS. The user speaks to themselves through their own messages — every reflective sentence reveals WHO inside them is speaking. Classify each piece of self-talk into exactly ONE of ten voices:",
    "",
    "  critic       — self-judgement, harsh evaluation, shoulds, accusations against the self ('I'm being lazy', 'I should know better', 'why am I like this')",
    "  dreamer      — vision, ambition, possibility, longing ('I want to build', 'imagine if', 'one day I will')",
    "  calculator   — reasoning, plans, trade-offs, math ('if X then Y', 'the cost of this is', 'breaking this down')",
    "  frightened   — fear, anxiety, dread, what-ifs ('I'm worried', 'what if it fails', 'I'm scared this means')",
    "  soldier      — discipline, push, grind, no-excuses ('just push through', 'no more slacking', 'I have to do this whether I feel like it or not')",
    "  philosopher  — meaning-making, reflection on identity, big questions ('what does this even mean', 'who am I really', 'is this who I want to be')",
    "  victim       — blame, helplessness, repetition of being wronged ('this always happens to me', 'nothing works', 'they always do this')",
    "  coach        — encouragement, self-cheering, reframing, building self up ('you've got this', 'break it down', 'one step at a time')",
    "  comedian     — deflection through humour, irony, self-mockery used to dodge ('classic me', 'lol another disaster', 'somehow I survived this')",
    "  scholar      — curiosity, observation, learning, dispassionate noticing ('interesting that X', 'I wonder why', 'I notice I do this when')",
    "",
    "Output strict JSON ONLY:",
    `{"atlas_narrative": "...", "utterances": [{"excerpt":"...", "voice":"...", "gloss":"...", "intensity":1-5, "msg_id":"..."}]}`,
    "",
    "Rules:",
    "- Extract 25-80 utterances total. One excerpt per voice tag. The same message can yield multiple utterances if multiple voices speak in it (it's common for critic and frightened to alternate in one message).",
    "- excerpt: verbatim sentence or sentence fragment from the user's message, ≤320 chars. Don't paraphrase. Pick the sharpest part of the self-talk.",
    "- voice: exactly one of the ten — never invent new voices, never combine.",
    "- gloss: one short line (≤120 chars) interpreting WHAT this voice is doing here. NOT a paraphrase. Examples: 'judging the self for taking a rest day', 'imagining the version of life with the agency closed', 'pushing past the fear with discipline'. British English, no em-dashes.",
    "- intensity: 1-5. 5 = explosive/extreme ('I am completely worthless'); 4 = strong; 3 = clear; 2 = mild; 1 = trace.",
    "- msg_id: EXACT msg_id from the [date|msg_id|conv:...] tag. Copy from the tag.",
    "",
    "atlas_narrative: 2-3 sentences (≤400 chars total) describing the texture of this person's inner voice based on the mix you found. Examples: 'Your inner voice in this window is dominated by the critic, with the dreamer surfacing late at night and the soldier doing most of the daytime work. The philosopher is rare but precise when it shows.' Be honest and specific. British English. No em-dashes. No clichés. No therapy-speak. Don't address the user as 'you' too often — speak ABOUT the voice mix.",
    "",
    "DO NOT include:",
    "- Operational instructions to the assistant ('open Slack', 'send Sarah an email')",
    "- Pure factual reports ('the deploy failed', 'meeting at 3pm')",
    "- Questions whose only purpose is information retrieval ('what's the weather')",
    "",
    "DO include:",
    "- Mid-sentence reflections embedded in operational messages ('I should probably stop deferring this — open the doc')",
    "- Half-formed thoughts and asides — these are often where the voice is purest",
    "",
    "Be precise about voice. The same words can be different voices depending on context — 'I have to do this' from a frightened place vs from a soldier place reads differently.",
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

  let parsed: { atlas_narrative?: unknown; utterances?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.utterances)) {
    return NextResponse.json({ error: "model output missing utterances array" }, { status: 502 });
  }

  type Parsed = {
    excerpt?: unknown;
    voice?: unknown;
    gloss?: unknown;
    intensity?: unknown;
    msg_id?: unknown;
  };

  type Utt = {
    voice: string;
    excerpt: string;
    gloss: string;
    intensity: number;
    spoken_at: string;
    source_message_id: string | null;
    source_conversation_id: string | null;
  };

  const utterances: Utt[] = [];
  for (const u of parsed.utterances as Parsed[]) {
    const voice = typeof u.voice === "string" && VALID_VOICES.has(u.voice) ? u.voice : null;
    const excerpt = typeof u.excerpt === "string" ? u.excerpt.trim().slice(0, 320) : "";
    const gloss = typeof u.gloss === "string" ? u.gloss.trim().slice(0, 200) : "";
    const intensity = typeof u.intensity === "number" ? Math.max(1, Math.min(5, Math.round(u.intensity))) : null;
    const msgId = typeof u.msg_id === "string" ? u.msg_id.trim() : "";

    if (!voice || !intensity) continue;
    if (excerpt.length < 8 || gloss.length < 4) continue;
    if (!msgId || !msgDates.has(msgId)) continue;

    utterances.push({
      voice,
      excerpt,
      gloss,
      intensity,
      spoken_at: msgDates.get(msgId) as string,
      source_message_id: msgId,
      source_conversation_id: msgConvos.get(msgId) ?? null,
    });
  }

  if (utterances.length < 5) {
    return NextResponse.json({ error: "scan produced too few qualifying utterances — try a longer window" }, { status: 400 });
  }

  // Voice counts + dominant
  const counts: Record<string, number> = {};
  for (const u of utterances) counts[u.voice] = (counts[u.voice] ?? 0) + 1;
  const ordered = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const dominant = ordered[0]?.[0] ?? null;
  const second = ordered[1]?.[0] ?? null;

  const narrative = typeof parsed.atlas_narrative === "string" ? parsed.atlas_narrative.trim().slice(0, 600) : "";

  const latencyMs = Date.now() - t0;

  // Insert scan first to get id
  const { data: scanInsert, error: scanErr } = await supabase
    .from("inner_voice_atlas_scans")
    .insert({
      user_id: user.id,
      window_days: windowDays,
      total_utterances: utterances.length,
      dominant_voice: dominant,
      second_voice: second,
      voice_counts: counts,
      atlas_narrative: narrative || null,
      latency_ms: latencyMs,
      model,
    })
    .select("id, dominant_voice, second_voice, voice_counts, atlas_narrative, total_utterances, window_days, created_at")
    .single();
  if (scanErr || !scanInsert) return NextResponse.json({ error: scanErr?.message ?? "scan insert failed" }, { status: 500 });

  const scanId = scanInsert.id as string;

  const toInsert = utterances.map((u) => ({
    user_id: user.id,
    scan_id: scanId,
    voice: u.voice,
    excerpt: u.excerpt,
    gloss: u.gloss,
    intensity: u.intensity,
    spoken_at: u.spoken_at,
    source_message_id: u.source_message_id,
    source_conversation_id: u.source_conversation_id,
  }));

  const { data: inserted, error } = await supabase
    .from("inner_voices")
    .insert(toInsert)
    .select("id, scan_id, voice, excerpt, gloss, intensity, spoken_at, source_conversation_id, source_message_id, pinned, archived_at, user_note, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan: scanInsert,
    inserted: inserted?.length ?? 0,
    utterances: inserted ?? [],
    latency_ms: latencyMs,
    signals: {
      total_messages: messages.length,
      candidate_messages: candidates.length,
      sampled: sampled.length,
    },
  });
}
