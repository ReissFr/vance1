// POST /api/mind-theatre/convene — Mind Theatre (§168).
//
// Body: { question: string, context_note?: string, voice_ids?: string[] }
//
// Convenes cabinet voices to speak IN CHARACTER on a question the user is
// sitting with. Pulls top N active voices from voice_cabinet (by airtime +
// severity), then ONE Haiku call generates each voice's stance + reply +
// reasoning using their typical_obligations, voice_relation, and voice_type
// as the character brief.
//
// The user reads the panel, then resolves the session via PATCH /[id]:
//   went_with_voice / self_authored / silenced_voice / unresolved.

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 3500;
const MAX_VOICES = 5;

const VALID_STANCES = new Set(["push", "pull", "protect", "caution", "ambivalent"]);

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const t0 = Date.now();

  let body: { question?: unknown; context_note?: unknown; voice_ids?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (question.length < 4) {
    return NextResponse.json({ error: "question is required (4+ chars) — name what you are sitting with" }, { status: 400 });
  }
  if (question.length > 1000) {
    return NextResponse.json({ error: "question too long (max 1000 chars)" }, { status: 400 });
  }

  const contextNote = typeof body.context_note === "string" ? body.context_note.trim().slice(0, 1500) : "";
  const requestedIds = Array.isArray(body.voice_ids) ? body.voice_ids.filter((x): x is string => typeof x === "string") : [];

  type CabinetRow = {
    id: string;
    voice_name: string;
    voice_type: string;
    voice_relation: string | null;
    typical_phrases: string[];
    typical_obligations: string;
    influence_severity: number;
    airtime_score: number;
    status: string;
  };

  const cabinetQuery = supabase
    .from("voice_cabinet")
    .select("id, voice_name, voice_type, voice_relation, typical_phrases, typical_obligations, influence_severity, airtime_score, status")
    .eq("user_id", user.id)
    .is("archived_at", null);

  const { data: cabinetRows, error: cabErr } = requestedIds.length > 0
    ? await cabinetQuery.in("id", requestedIds)
    : await cabinetQuery
        .in("status", ["active", "acknowledged", "integrating"])
        .order("airtime_score", { ascending: false })
        .order("influence_severity", { ascending: false })
        .limit(MAX_VOICES);

  if (cabErr) return NextResponse.json({ error: cabErr.message }, { status: 500 });

  const voices = (cabinetRows ?? []) as CabinetRow[];
  if (voices.length === 0) {
    return NextResponse.json({
      error: "no cabinet voices to convene — populate the cabinet first via the Voice Cabinet scan",
    }, { status: 400 });
  }

  const voiceLines: string[] = [];
  voiceLines.push(`QUESTION FROM USER: "${question}"`);
  if (contextNote) {
    voiceLines.push("");
    voiceLines.push(`CONTEXT FROM USER: "${contextNote}"`);
  }
  voiceLines.push("");
  voiceLines.push(`PANEL OF ${voices.length} VOICES TO CONVENE:`);
  voiceLines.push("");
  for (const v of voices) {
    voiceLines.push(`--- VOICE id=${v.id} ---`);
    voiceLines.push(`name: ${v.voice_name}`);
    voiceLines.push(`type: ${v.voice_type}`);
    if (v.voice_relation) voiceLines.push(`relation: ${v.voice_relation}`);
    voiceLines.push(`severity: ${v.influence_severity}/5 | airtime: ${v.airtime_score} attributions`);
    voiceLines.push(`typical_obligations: ${v.typical_obligations}`);
    if (Array.isArray(v.typical_phrases) && v.typical_phrases.length > 0) {
      voiceLines.push(`typical_phrases (verbatim from user):`);
      for (const p of v.typical_phrases.slice(0, 5)) {
        voiceLines.push(`  - "${String(p).replace(/\n+/g, " ").slice(0, 180)}"`);
      }
    }
    voiceLines.push("");
  }

  const system = [
    "You are running a Mind Theatre session: a panel of named INNER VOICES that live in a user's head, each speaking in character to a current question or decision the user is sitting with.",
    "",
    "Each voice on the panel has been profiled from the user's own should-ledger evidence: what it tends to demand, how it speaks, what relation it has to the user, how loud it is. You are NOT generating fresh personas. You are voicing the named voice the user already lives with.",
    "",
    "For each voice, output:",
    "  voice_id     — the id from the panel block, copied verbatim.",
    "  voice_name   — copied verbatim.",
    "  stance       — one of: 'push' (this voice is pushing the user TOWARD the thing in the question), 'pull' (this voice is pulling the user AWAY from it), 'protect' (this voice is warning, guarding against a downside), 'caution' (mixed — this voice sees both sides), 'ambivalent' (this voice doesn't have a clear position on this specific question).",
    "  reply        — 1-3 sentences spoken IN THE FIRST PERSON as if the voice itself is speaking to the user. Use the voice's typical phrasing and obligations as the character brief. Examples: 'You should call your mum more — when was the last time you actually rang her?' / 'You're not a real founder if you can't ship something this week.' / 'Stop making it about money — what would you actually enjoy?' Speak AS the voice. Never break character. Never explain.",
    "  reasoning    — 1 sentence (max 30 words) describing WHY this voice would say that, written ABOUT the voice (third person), so the user can evaluate the panel. Example: 'Mum's voice tends to surface around relational distance and frames silence as failure to maintain.'",
    "",
    "Rules:",
    "- Emit one entry per voice on the panel. Same order. No skipping.",
    "- Replies must be in character — match the typical_obligations and typical_phrases. Don't make voices nicer or harsher than the evidence shows.",
    "- Stance must be honest. If the voice has nothing to say about THIS specific question, mark it 'ambivalent' with a short acknowledgement in the reply ('I don't really have a take on this one').",
    "- British English. No em-dashes. No emojis.",
    "- Keep the reply tight — this is theatre, not therapy. Each voice gets a moment, not a monologue.",
    "",
    "Output strict JSON ONLY:",
    `{"panel": [{"voice_id":"...","voice_name":"...","stance":"push|pull|protect|caution|ambivalent","reply":"...","reasoning":"..."}]}`,
  ].join("\n");

  const userMsg = ["EVIDENCE:", "", voiceLines.join("\n")].join("\n");

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

  let parsed: { panel?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.panel)) {
    return NextResponse.json({ error: "model output missing panel array" }, { status: 502 });
  }

  type ParsedPanel = {
    voice_id?: unknown;
    voice_name?: unknown;
    stance?: unknown;
    reply?: unknown;
    reasoning?: unknown;
  };

  type PanelEntry = {
    voice_id: string;
    voice_name: string;
    voice_type: string;
    voice_relation: string | null;
    severity: number;
    airtime: number;
    stance: string;
    reply: string;
    reasoning: string;
  };

  const voicesById = new Map<string, CabinetRow>();
  for (const v of voices) voicesById.set(v.id, v);

  const panel: PanelEntry[] = [];
  const seen = new Set<string>();
  for (const p of parsed.panel as ParsedPanel[]) {
    const vid = typeof p.voice_id === "string" ? p.voice_id : "";
    if (!vid || seen.has(vid)) continue;
    const row = voicesById.get(vid);
    if (!row) continue;
    const stance = typeof p.stance === "string" && VALID_STANCES.has(p.stance) ? p.stance : "ambivalent";
    const reply = typeof p.reply === "string" ? p.reply.trim().slice(0, 600) : "";
    if (reply.length < 3) continue;
    const reasoning = typeof p.reasoning === "string" ? p.reasoning.trim().slice(0, 300) : "";
    seen.add(vid);
    panel.push({
      voice_id: vid,
      voice_name: row.voice_name,
      voice_type: row.voice_type,
      voice_relation: row.voice_relation,
      severity: row.influence_severity,
      airtime: row.airtime_score,
      stance,
      reply,
      reasoning,
    });
  }

  if (panel.length === 0) {
    return NextResponse.json({ error: "model produced no usable panel entries", raw: raw.slice(0, 400) }, { status: 502 });
  }

  const stanceCounts = new Map<string, number>();
  for (const p of panel) stanceCounts.set(p.stance, (stanceCounts.get(p.stance) ?? 0) + 1);
  let dominantStance: string | null = null;
  let dominantCount = 0;
  for (const [s, c] of stanceCounts.entries()) {
    if (c > dominantCount) { dominantStance = s; dominantCount = c; }
  }

  const latencyMs = Date.now() - t0;

  const { data: inserted, error: insErr } = await supabase
    .from("mind_theatre_sessions")
    .insert({
      user_id: user.id,
      question,
      context_note: contextNote || null,
      panel,
      voices_consulted: panel.length,
      dominant_stance: dominantStance,
      latency_ms: latencyMs,
      model,
    })
    .select("id, question, context_note, panel, voices_consulted, dominant_stance, outcome, chosen_voice_id, silenced_voice_id, self_authored_answer, decision_note, latency_ms, model, created_at, resolved_at, archived_at")
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    session: inserted,
    latency_ms: latencyMs,
  });
}

export async function GET() {
  return NextResponse.json({ error: "POST only" }, { status: 405 });
}
