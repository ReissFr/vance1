// POST /api/counter-self — instantiate a CHALLENGER against a position.
//   Body: {
//     target_kind: 'decision' | 'identity_claim' | 'theme' | 'policy' | 'reflection' | 'generic',
//     target_id?: uuid (required for non-generic kinds),
//     target_snapshot?: string (required for 'generic'; otherwise overrides the row's text if provided),
//     challenger_voice: 'smart_cynic' | 'concerned_mentor' | 'failure_timeline_self' | 'external_skeptic' | 'peer_been_there'
//   }
//
// GET /api/counter-self — list chamber sessions.
//   ?status=open|engaged|deferred|updated_position|dismissed|resolved|archived|pinned|all (default open)
//   ?target_kind=decision|... (optional)
//   ?limit=N (default 30, max 100)

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 2400;

const VALID_KINDS = new Set(["decision", "identity_claim", "theme", "policy", "reflection", "generic"]);
const VALID_VOICES = new Set(["smart_cynic", "concerned_mentor", "failure_timeline_self", "external_skeptic", "peer_been_there"]);

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

const VOICE_BRIEFS: Record<string, string> = {
  smart_cynic: "You are the SMART CYNIC. You assume the worst about motives without being sneering. You see ego, self-deception, status games, comfort-seeking dressed up as principle. You name them clearly. You don't soften. You aren't cruel — you're sharp because the kindness of pretending isn't kindness. You sound like a friend who has known the user for fifteen years, who calls bullshit but doesn't enjoy it.",
  concerned_mentor: "You are the CONCERNED MENTOR. You believe in the user, which is exactly why you can't let this position stand unchallenged. You are kind but firm. You name the blind spot, the unaddressed risk, the thing the user is choosing not to see. You assume good intent and challenge the conclusion. You sound like someone who has lived through what's coming and is trying to spare the user the worst of it.",
  failure_timeline_self: "You are the user, voicing from the FAILURE TIMELINE — the version of them who pursued this exact position and watched it fall apart. You write in first person, addressing the present-day user as 'you'. You name what specifically broke, when, in what order. You don't gloat. You're trying to be heard, because you ARE the user, and the present-day them is about to walk into what you've already lived.",
  external_skeptic: "You are the EXTERNAL SKEPTIC. You have no skin in the game, no history with the user, no investment in their narrative. You read the position cold and find the holes a stranger would find. You sound clinical. You aren't trying to help — you're modelling what an outsider would say if they audited the reasoning without context, which is precisely what makes you useful.",
  peer_been_there: "You are the PEER WHO HAS BEEN THERE. You aren't above the user — you ARE the user, six steps further down a similar road. You don't lecture; you trade. You say 'I tried this exact thing, here's what happened, here's where my reasoning was wrong.' You're warm, but warm is not soft. You write like you've earned the right to push back because you've paid for the lesson.",
};

const VOICE_LABEL: Record<string, string> = {
  smart_cynic: "the smart cynic",
  concerned_mentor: "the concerned mentor",
  failure_timeline_self: "your failure-timeline self",
  external_skeptic: "the external skeptic",
  peer_been_there: "the peer who has been there",
};

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { target_kind?: string; target_id?: string; target_snapshot?: string; challenger_voice?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const targetKind = typeof body.target_kind === "string" ? body.target_kind : "";
  const challengerVoice = typeof body.challenger_voice === "string" ? body.challenger_voice : "";
  if (!VALID_KINDS.has(targetKind)) return NextResponse.json({ error: "invalid target_kind" }, { status: 400 });
  if (!VALID_VOICES.has(challengerVoice)) return NextResponse.json({ error: "invalid challenger_voice" }, { status: 400 });

  const t0 = Date.now();

  // Resolve target_snapshot
  let targetSnapshot = "";
  let targetId: string | null = null;
  let extraContext = "";

  if (targetKind === "generic") {
    if (typeof body.target_snapshot !== "string" || body.target_snapshot.trim().length < 12) {
      return NextResponse.json({ error: "target_snapshot required for generic kind (min 12 chars)" }, { status: 400 });
    }
    targetSnapshot = body.target_snapshot.trim().slice(0, 1200);
  } else {
    if (typeof body.target_id !== "string" || !isUuid(body.target_id)) {
      return NextResponse.json({ error: `target_id (uuid) required for kind=${targetKind}` }, { status: 400 });
    }
    targetId = body.target_id;
    if (targetKind === "decision") {
      const { data } = await supabase.from("decisions").select("title, choice, expected_outcome, tags").eq("id", targetId).eq("user_id", user.id).maybeSingle();
      if (!data) return NextResponse.json({ error: "decision not found" }, { status: 404 });
      const d = data as { title: string; choice: string | null; expected_outcome: string | null; tags: string[] | null };
      targetSnapshot = `${d.title}${d.choice ? ` — chose: ${d.choice}` : ""}`;
      if (d.expected_outcome) extraContext = `EXPECTED OUTCOME (per the user): ${d.expected_outcome}`;
    } else if (targetKind === "identity_claim") {
      const { data } = await supabase.from("identity_claims").select("statement, kind, occurrences").eq("id", targetId).eq("user_id", user.id).maybeSingle();
      if (!data) return NextResponse.json({ error: "identity claim not found" }, { status: 404 });
      const d = data as { statement: string; kind: string; occurrences: number };
      targetSnapshot = `[${d.kind}] ${d.statement}`;
      extraContext = `This is an active identity claim that has appeared ${d.occurrences} times in the user's writing.`;
    } else if (targetKind === "theme") {
      const { data } = await supabase.from("themes").select("title, current_state, status").eq("id", targetId).eq("user_id", user.id).maybeSingle();
      if (!data) return NextResponse.json({ error: "theme not found" }, { status: 404 });
      const d = data as { title: string; current_state: string | null; status: string };
      targetSnapshot = `${d.title}${d.current_state ? ` — current state: ${d.current_state}` : ""}`;
      extraContext = `Theme status: ${d.status}.`;
    } else if (targetKind === "policy") {
      const { data } = await supabase.from("policies").select("name, rule, category, priority").eq("id", targetId).eq("user_id", user.id).maybeSingle();
      if (!data) return NextResponse.json({ error: "policy not found" }, { status: 404 });
      const d = data as { name: string; rule: string; category: string; priority: number };
      targetSnapshot = `${d.name}: ${d.rule}`;
      extraContext = `Policy category: ${d.category}, priority ${d.priority}/5.`;
    } else if (targetKind === "reflection") {
      const { data } = await supabase.from("reflections").select("text, kind, tags, created_at").eq("id", targetId).eq("user_id", user.id).maybeSingle();
      if (!data) return NextResponse.json({ error: "reflection not found" }, { status: 404 });
      const d = data as { text: string; kind: string; tags: string[] | null; created_at: string };
      targetSnapshot = d.text;
      extraContext = `Reflection kind: ${d.kind}${d.tags?.length ? `, tags: ${d.tags.slice(0, 4).join(", ")}` : ""}.`;
    }
    if (typeof body.target_snapshot === "string" && body.target_snapshot.trim().length >= 12) {
      // explicit override wins
      targetSnapshot = body.target_snapshot.trim().slice(0, 1200);
    } else {
      targetSnapshot = targetSnapshot.slice(0, 1200);
    }
  }

  const voiceBrief = VOICE_BRIEFS[challengerVoice] ?? "";
  const voiceLabel = VOICE_LABEL[challengerVoice] ?? challengerVoice;

  const system = [
    `You are role-playing ${voiceLabel.toUpperCase()} in the user's COUNTER-SELF CHAMBER. The user is bringing a position they hold, and asking you to make the strongest possible argument AGAINST it from this voice. Your job is not to win — your job is to give them the sharpest version of the case they would have to defeat to be confident in their position.`,
    "",
    voiceBrief,
    "",
    "Output strict JSON ONLY:",
    `{"argument_body": "...", "strongest_counterpoint": "...", "falsifiable_predictions": [{"prediction": "...", "by_when": "..."}, ...]}`,
    "",
    "Rules:",
    "- argument_body: 200-400 words. ONE continuous prose argument in your voice. Address the user as 'you' (or 'I' if you are the failure-timeline-self voice). Lead with the sharpest single objection, then build the case, then end with the part the user will find hardest to dismiss. Don't summarise the user's position back at them — they wrote it. Don't ask questions — make the case. Quote specific phrases from their position when it strengthens the attack.",
    "- strongest_counterpoint: ONE sentence isolating the single most cutting objection. This is the line the user should sit with overnight. Make it land.",
    "- falsifiable_predictions: 0-3 predictions of what the user will observe IF they're wrong about this position. Each {prediction, by_when} where by_when is a concrete timeframe ('within 3 months', 'by end of Q3', 'within the next 5 attempts'). These are the trip-wires — if any fire, the user knows the position needs revisiting. If no falsifiable predictions are possible for this position, return [] — don't fabricate.",
    "",
    "Hard rules:",
    "- DO NOT moralise. DO NOT lecture. DO NOT hedge with 'I might be wrong but...'. The whole point is the unhedged adversary.",
    "- DO NOT recommend changes. You're not the mentor in the next room — you're the case for the prosecution. The user decides what to do.",
    "- DO NOT be cruel for cruelty's sake. The voice is sharp because clarity is kind, not because the user deserves to be hurt.",
    "- British English, no em-dashes, no clichés.",
  ].join("\n");

  const userMsg = [
    `POSITION TO CHALLENGE (target_kind=${targetKind}):`,
    "",
    targetSnapshot,
    "",
    extraContext ? `CONTEXT:` : "",
    extraContext,
    "",
    "Write your case against this position now.",
  ].filter(Boolean).join("\n");

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

  let parsed: { argument_body?: unknown; strongest_counterpoint?: unknown; falsifiable_predictions?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (typeof parsed.argument_body !== "string" || parsed.argument_body.trim().length < 80) {
    return NextResponse.json({ error: "argument_body missing or too short" }, { status: 502 });
  }

  type RawPred = { prediction?: unknown; by_when?: unknown };
  const predictions: Array<{ prediction: string; by_when: string }> = [];
  if (Array.isArray(parsed.falsifiable_predictions)) {
    for (const p of parsed.falsifiable_predictions as RawPred[]) {
      const pred = typeof p.prediction === "string" ? p.prediction.trim().slice(0, 400) : "";
      const byWhen = typeof p.by_when === "string" ? p.by_when.trim().slice(0, 80) : "";
      if (pred.length >= 8 && byWhen.length >= 2) predictions.push({ prediction: pred, by_when: byWhen });
      if (predictions.length >= 3) break;
    }
  }

  const insertRow = {
    user_id: user.id,
    target_kind: targetKind,
    target_id: targetId,
    target_snapshot: targetSnapshot,
    challenger_voice: challengerVoice,
    argument_body: parsed.argument_body.trim().slice(0, 4000),
    strongest_counterpoint: typeof parsed.strongest_counterpoint === "string" ? parsed.strongest_counterpoint.trim().slice(0, 400) : null,
    falsifiable_predictions: predictions,
    latency_ms: Date.now() - t0,
    model,
  };

  const { data: inserted, error } = await supabase
    .from("counter_self_chambers")
    .insert(insertRow)
    .select("id, target_kind, target_id, target_snapshot, challenger_voice, argument_body, strongest_counterpoint, falsifiable_predictions, user_response, user_response_body, new_position_text, resolved_at, pinned, archived_at, latency_ms, model, created_at")
    .single();
  if (error || !inserted) return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });

  return NextResponse.json({ counter_self: inserted });
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "open";
  const targetKindParam = url.searchParams.get("target_kind");
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.max(1, Math.min(100, isNaN(limitRaw) ? 30 : limitRaw));

  let q = supabase
    .from("counter_self_chambers")
    .select("id, target_kind, target_id, target_snapshot, challenger_voice, argument_body, strongest_counterpoint, falsifiable_predictions, user_response, user_response_body, new_position_text, resolved_at, pinned, archived_at, latency_ms, model, created_at")
    .eq("user_id", user.id);

  if (targetKindParam && VALID_KINDS.has(targetKindParam)) q = q.eq("target_kind", targetKindParam);

  if (status === "open") q = q.is("user_response", null).is("archived_at", null);
  else if (status === "engaged") q = q.eq("user_response", "engaged");
  else if (status === "deferred") q = q.eq("user_response", "deferred");
  else if (status === "updated_position") q = q.eq("user_response", "updated_position");
  else if (status === "dismissed") q = q.eq("user_response", "dismissed");
  else if (status === "resolved") q = q.not("user_response", "is", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);

  q = q.order("created_at", { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ counter_self_chambers: data ?? [] });
}
