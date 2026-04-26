// POST /api/said-i-would/scan — THE SAID-I-WOULD LEDGER (§175).
//
// Body: { window_days?: 7-90 (default 30) }
//
// Mines the user's chats for CASUAL promises — "I'll text her tomorrow",
// "I'll send that email this weekend", "let me check it next month".
// Distinct from §172 vows (eternal promises) and §168 shoulds (felt
// obligations) and the commitments table (commitments TO others).
//
// Two novel hooks:
//   1. HORIZON INFERENCE — the model returns horizon_text (the EXACT
//      phrase used) and horizon_kind (the bucket). The server computes
//      target_date from horizon_kind + spoken_date itself; we don't
//      trust the model's date arithmetic.
//   2. FOLLOW-THROUGH CALIBRATION — once enough promises are resolved,
//      the list endpoint returns follow_through_rate per domain and per
//      horizon_kind. The user discovers things like "I keep 90% of
//      work-promises but 23% of health-promises".
//
// UPSERT-by-(user_id, spoken_message_id, promise_text). One message can
// contain multiple promises so the dedup key includes promise_text.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 4000;

const VALID_HORIZON = new Set([
  "today", "tomorrow", "this_week", "this_weekend", "next_week",
  "this_month", "next_month", "soon", "eventually", "unspecified",
]);
const VALID_DOMAIN = new Set([
  "work", "health", "relationships", "family", "finance",
  "creative", "self", "spiritual", "other",
]);

// Trigger phrases for filtering candidates before sending to model.
// Promise-shaped utterances tend to use modal-future constructions or
// imminent-action phrasing. We cast a wide net here and let the model
// reject false positives.
const TRIGGER = /\b(?:i['']?ll|i['']?ve got to|i['']?ve gotta|i['']?m gonna|i['']?m going to|i'?m about to|let me|imma|i need to|i have to|i must|i should probably|i plan to|i intend to|i'?ll try|i'?ll get|i'?ll do|i'?ll send|i'?ll text|i'?ll call|i'?ll email|i'?ll book|i'?ll fix|i'?ll start|i'?ll finish|i'?ll write|i'?ll read|i'?ll check|i'?ll sort|i'?ll handle|i'?ll think|i'?ll get back|reminding myself to|going to (?:do|finish|send|text|email|fix|start)|tomorrow i|tonight i|this week|this weekend|next week|next month|by (?:friday|monday|tuesday|wednesday|thursday|saturday|sunday|the end of|tomorrow|tonight)|on it|will do)\b/i;

function dateOnly(iso: string): string { return iso.slice(0, 10); }

// Compute target_date from spoken_date and horizon_kind. Server-authoritative —
// the model's job is to identify the horizon, not to do calendar arithmetic.
function computeTargetDate(spokenDate: string, kind: string): string {
  const base = new Date(`${spokenDate}T00:00:00Z`);
  const day = (n: number) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + n);
    return dateOnly(d.toISOString());
  };
  const dow = base.getUTCDay(); // 0=Sun..6=Sat

  switch (kind) {
    case "today": return spokenDate;
    case "tomorrow": return day(1);
    case "this_week": {
      // mid-week from spoken — Friday end of week, but cap at +5
      const toFriday = (5 - dow + 7) % 7 || 5;
      return day(Math.min(5, toFriday));
    }
    case "this_weekend": {
      // upcoming Saturday
      const toSaturday = (6 - dow + 7) % 7 || 6;
      return day(toSaturday);
    }
    case "next_week": return day(9);
    case "this_month": {
      const endOfMonth = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
      const cap = day(14);
      return endOfMonth.getTime() < new Date(`${cap}T00:00:00Z`).getTime() ? dateOnly(endOfMonth.toISOString()) : cap;
    }
    case "next_month": return day(30);
    case "soon": return day(7);
    case "eventually": return day(60);
    case "unspecified":
    default:
      return day(14);
  }
}

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { window_days?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const windowDays = Math.max(7, Math.min(90, Math.round(body.window_days ?? 30)));
  const t0 = Date.now();
  const startIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  const { data: msgRows, error: msgErr } = await supabase
    .from("messages")
    .select("id, conversation_id, content, created_at, role")
    .eq("user_id", user.id)
    .eq("role", "user")
    .gte("created_at", startIso)
    .order("created_at", { ascending: true })
    .limit(2000);
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  type Msg = { id: string; conversation_id: string; content: string; created_at: string };
  const userMessages = (msgRows ?? []) as Msg[];

  if (userMessages.length < 5) {
    return NextResponse.json({ error: "not enough chat history in this window" }, { status: 400 });
  }

  const candidates = userMessages
    .filter((m) => m.content.length >= 12 && m.content.length <= 2000)
    .filter((m) => TRIGGER.test(m.content));

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no promise-shaped messages found", latency_ms: Date.now() - t0 });
  }

  // Cap to 200 candidates — promise extraction is dense; we don't need
  // the whole window if the user has been chatty.
  const SAMPLE_LIMIT = 200;
  const sampled = candidates.length <= SAMPLE_LIMIT
    ? candidates
    : (() => {
        const step = candidates.length / SAMPLE_LIMIT;
        const out: typeof candidates = [];
        for (let i = 0; i < SAMPLE_LIMIT; i += 1) {
          const idx = Math.floor(i * step);
          const item = candidates[idx];
          if (item) out.push(item);
        }
        return out;
      })();

  const msgDates = new Map<string, string>();
  const msgConvos = new Map<string, string>();
  for (const m of sampled) {
    msgDates.set(m.id, dateOnly(m.created_at));
    msgConvos.set(m.id, m.conversation_id);
  }

  const lines: string[] = [];
  for (const m of sampled) {
    const trimmed = m.content.length > 320 ? m.content.slice(0, 280) + " ..." : m.content;
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}] ${trimmed.replace(/\n+/g, " ")}`);
  }

  const system = [
    "You are extracting CASUAL PROMISES the user made to themselves in passing — small things they said they'd do. NOT eternal vows. NOT formal commitments to other people. Just the everyday 'I'll text her tomorrow', 'I'll fix that bug today', 'I'll book that flight this weekend' style of utterance.",
    "",
    "Examples that QUALIFY:",
    "- 'I'll send the report tomorrow' -> promise_text: 'send the report'; horizon_text: 'tomorrow'; horizon_kind: tomorrow; domain: work",
    "- 'gotta call mum this weekend' -> promise_text: 'call mum'; horizon_text: 'this weekend'; horizon_kind: this_weekend; domain: family",
    "- 'I'll get to that next month' -> promise_text: 'get to that'; horizon_text: 'next month'; horizon_kind: next_month; domain: depends-on-context",
    "- 'I should probably book the dentist' -> promise_text: 'book the dentist'; horizon_text: ''; horizon_kind: unspecified; domain: health",
    "- 'I'm going to start running again next week' -> domain: health; horizon: next_week",
    "",
    "DOES NOT qualify:",
    "- eternal vows ('I will never let work define me') — that's §172, not this.",
    "- felt obligations without commitment ('I should but I won't', 'I know I should but...') — that's §168.",
    "- commitments to OTHERS ('I told her I'd call by Friday') — that's the commitments table.",
    "- already-done in same message ('I'll send it — done').",
    "- abstract intentions without action ('I want to be more present').",
    "- conditional or uncertain ('I might', 'maybe I'll', 'thinking about').",
    "",
    "For each promise output:",
    "  promise_text  — the action distilled to ≤120 chars. Verb + object. Drop pronouns and modals. NOT 'I will send the report'; YES 'send the report'.",
    "  horizon_text  — the EXACT phrase the user used to indicate when (e.g. 'tomorrow', 'this weekend', 'next month', 'tonight', 'by friday', 'in a bit', 'soon'). If no time was given, ''.",
    "  horizon_kind  — ONE of: today / tomorrow / this_week / this_weekend / next_week / this_month / next_month / soon / eventually / unspecified.",
    "    today        — 'today', 'this morning', 'this afternoon', 'tonight', 'in a bit', 'right now'",
    "    tomorrow     — 'tomorrow', 'tomorrow morning', 'first thing tomorrow'",
    "    this_week    — 'this week', 'before friday', 'by the end of the week'",
    "    this_weekend — 'this weekend', 'on saturday', 'on sunday' (when sunday/saturday is upcoming)",
    "    next_week    — 'next week', 'next monday', 'next tuesday'",
    "    this_month   — 'this month', 'before the end of the month'",
    "    next_month   — 'next month'",
    "    soon         — 'soon', 'in the next few days', 'shortly'",
    "    eventually   — 'eventually', 'one of these days', 'at some point'",
    "    unspecified  — no horizon was named ('I should probably book the dentist')",
    "  domain        — work / health / relationships / family / finance / creative / self / spiritual / other.",
    "  msg_id        — the EXACT msg_id from the [date|msg_id] tag.",
    "  confidence    — 1-5. 1 = ambiguous; 5 = clearly a casual self-directed promise with explicit action.",
    "",
    "Output strict JSON ONLY:",
    `{"promises": [{"promise_text":"...", "horizon_text":"...", "horizon_kind":"...", "domain":"...", "msg_id":"...", "confidence": 3}]}`,
    "",
    "Rules:",
    "- Multiple promises in one message: emit one row per promise.",
    "- horizon_text MUST be the exact words the user used. Empty string if no horizon was stated.",
    "- horizon_kind: pick the closest bucket. If genuinely no horizon, use 'unspecified'.",
    "- DROP confidence < 2.",
    "- DROP if the promise was already done in the same message.",
    "- DROP if it's a vow or eternal commitment.",
    "- DROP commitments TO others (the system has a separate table for those).",
    "",
    "Quality over quantity. British English. No em-dashes.",
  ].join("\n");

  const userMsg = ["EVIDENCE — promise-shaped messages:", "", lines.join("\n")].join("\n");

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

  let parsed: { promises?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.promises)) {
    return NextResponse.json({ error: "model output missing promises array" }, { status: 502 });
  }

  type ParsedP = {
    promise_text?: unknown;
    horizon_text?: unknown;
    horizon_kind?: unknown;
    domain?: unknown;
    msg_id?: unknown;
    confidence?: unknown;
  };

  type ValidP = {
    promise_text: string;
    horizon_text: string;
    horizon_kind: string;
    domain: string;
    spoken_message_id: string;
    spoken_date: string;
    conversation_id: string;
    target_date: string;
    confidence: number;
  };

  const valid: ValidP[] = [];
  for (const p of parsed.promises as ParsedP[]) {
    const text = typeof p.promise_text === "string" ? p.promise_text.trim().slice(0, 280) : "";
    const horizonText = typeof p.horizon_text === "string" ? p.horizon_text.trim().slice(0, 80) : "";
    const horizonKind = typeof p.horizon_kind === "string" && VALID_HORIZON.has(p.horizon_kind) ? p.horizon_kind : null;
    const domain = typeof p.domain === "string" && VALID_DOMAIN.has(p.domain) ? p.domain : null;
    const msgId = typeof p.msg_id === "string" ? p.msg_id.trim() : "";
    const confidence = typeof p.confidence === "number" ? Math.max(1, Math.min(5, Math.round(p.confidence))) : 3;

    if (!horizonKind || !domain) continue;
    if (text.length < 4) continue;
    if (!msgId || !msgDates.has(msgId)) continue;
    if (confidence < 2) continue;

    const spokenDate = msgDates.get(msgId) as string;
    const conversationId = msgConvos.get(msgId) as string;
    const targetDate = computeTargetDate(spokenDate, horizonKind);

    valid.push({
      promise_text: text,
      horizon_text: horizonText || (horizonKind === "unspecified" ? "" : horizonKind.replace(/_/g, " ")),
      horizon_kind: horizonKind,
      domain,
      spoken_message_id: msgId,
      spoken_date: spokenDate,
      conversation_id: conversationId,
      target_date: targetDate,
      confidence,
    });
  }

  if (valid.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no promises detected", latency_ms: Date.now() - t0 });
  }

  const scanId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const latencyMs = Date.now() - t0;

  // UPSERT-by-(user_id, spoken_message_id, promise_text). We fetch
  // existing rows whose (msg_id, promise_text) match new ones, and skip
  // them so rescans don't churn the user's resolved status / pinned /
  // archived state.
  const msgIds = Array.from(new Set(valid.map((v) => v.spoken_message_id)));
  const { data: existingRows } = await supabase
    .from("said_i_woulds")
    .select("id, spoken_message_id, promise_text")
    .eq("user_id", user.id)
    .in("spoken_message_id", msgIds);
  const existingKey = new Set<string>();
  for (const r of (existingRows ?? [])) existingKey.add(`${r.spoken_message_id}::${r.promise_text}`);

  let inserted = 0;
  let skipped = 0;
  const insertedRows: Array<Record<string, unknown>> = [];

  for (const v of valid) {
    const key = `${v.spoken_message_id}::${v.promise_text}`;
    if (existingKey.has(key)) { skipped++; continue; }
    const { data: insRow, error: insErr } = await supabase
      .from("said_i_woulds")
      .insert({
        user_id: user.id,
        scan_id: scanId,
        promise_text: v.promise_text,
        horizon_text: v.horizon_text,
        horizon_kind: v.horizon_kind,
        domain: v.domain,
        spoken_message_id: v.spoken_message_id,
        spoken_date: v.spoken_date,
        conversation_id: v.conversation_id,
        target_date: v.target_date,
        confidence: v.confidence,
        latency_ms: latencyMs,
        model,
      })
      .select("id, scan_id, promise_text, horizon_text, horizon_kind, domain, spoken_date, spoken_message_id, conversation_id, target_date, confidence, status, resolution_note, resolved_at, pinned, archived_at, created_at, updated_at")
      .single();
    if (!insErr && insRow) {
      inserted++;
      insertedRows.push(insRow);
    }
  }

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted,
    skipped,
    promises: insertedRows,
    latency_ms: latencyMs,
    signals: {
      sampled: sampled.length,
      candidates: candidates.length,
      emitted: valid.length,
    },
  });
}

export async function GET() {
  return NextResponse.json({ error: "POST only" }, { status: 405 });
}
