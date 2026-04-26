// POST /api/contradictions/scan — THE CONTRADICTIONS LEDGER (§176).
//
// Body: { window_days?: 30-540 (default 180) }
//
// Different mechanism from every utterance-extractor (§165–§175). Those
// tools mine for utterances of a particular SHAPE — "I used to", "I should",
// "I'll", "I always". This one does RELATIONAL extraction: identifies PAIRS
// of statements across the chat history that CONTRADICT each other.
//
// The model is given a chronological sample of substantive messages with
// dates and msg_ids and asked to find instances where the user said one
// thing on one date and a contradicting thing on another. Each pair is
// labelled with a CONTRADICTION_KIND (preference / belief / claim /
// commitment / identity / value / desire / appraisal), a TOPIC naming the
// territory of the inconsistency, a CHARGE, a CONFIDENCE, and a DOMAIN.
//
// Server orders the pair so statement_a is the EARLIER one (a_date <
// b_date) for stable storage and computes days_apart authoritatively.
// Stores both messages' ids; UPSERTs by (a_msg_id, b_msg_id) so rescans
// don't duplicate the same pair.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 5500;

const VALID_KINDS = new Set([
  "preference", "belief", "claim", "commitment",
  "identity", "value", "desire", "appraisal",
]);
const VALID_DOMAINS = new Set([
  "work", "health", "relationships", "family", "finance",
  "creative", "self", "spiritual", "other",
]);

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function dateOnly(iso: string): string { return iso.slice(0, 10); }
function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(`${aIso}T00:00:00Z`).getTime();
  const b = new Date(`${bIso}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { window_days?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const windowDays = Math.max(30, Math.min(540, Math.round(body.window_days ?? 180)));

  const t0 = Date.now();
  const startIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const todayDate = dateOnly(new Date().toISOString());
  const startDate = dateOnly(startIso);

  const { data: msgRows, error: msgErr } = await supabase
    .from("messages")
    .select("id, conversation_id, content, created_at, role")
    .eq("user_id", user.id)
    .eq("role", "user")
    .gte("created_at", startIso)
    .order("created_at", { ascending: true })
    .limit(2500);
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  type Msg = { id: string; conversation_id: string; content: string; created_at: string };
  const userMessages = (msgRows ?? []) as Msg[];

  if (userMessages.length < 30) {
    return NextResponse.json({ error: "not enough chat history in this window — try a longer window" }, { status: 400 });
  }

  // Length-filter only. Contradictions need substantive statements
  // (preferences, beliefs, identity claims) which tend to be in longer
  // messages.
  const candidates = userMessages.filter((m) => m.content.length >= 40 && m.content.length <= 3000);

  if (candidates.length < 30) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "not enough substantive messages — contradictions need more data", latency_ms: Date.now() - t0 });
  }

  const trimmed = candidates.map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    created_at: m.created_at,
    snippet: m.content.length > 360 ? m.content.slice(0, 320) + " ..." : m.content,
  }));

  // Sample evenly across the window. Contradictions need temporal coverage
  // so the model can find pairs separated by time.
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
  lines.push(`WINDOW: ${startDate} -> ${todayDate} (${windowDays} days)`);
  lines.push(`SAMPLED USER MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting CONTRADICTIONS — pairs of statements the user has said across this window where the LATER statement contradicts the EARLIER one. Two statements, separated by time, that cannot both fully be true (or that pull in opposite directions on the same territory).",
    "",
    "This is RELATIONAL extraction, not single-utterance extraction. You're looking for PAIRS.",
    "",
    "Examples that QUALIFY:",
    "- 2025-03-12: 'I'm a private person, I keep my work to myself.'  vs  2025-08-20: 'I want to be known for what I'm building, I want this to be public.'  → identity contradiction; topic 'how visible I want to be'",
    "- 2025-04-01: 'I've decided I'm done with relationships, I want to be alone.'  vs  2025-09-15: 'I really miss having someone, I want to date again.'  → desire / commitment contradiction; topic 'whether I want a relationship'",
    "- 2025-05-10: 'Money doesn't matter to me, I've never cared about it.'  vs  2025-11-02: 'I'm going to chase the highest-paying offer, the money matters more than I admitted.'  → value contradiction; topic 'how much money matters'",
    "- 2025-02-20: 'I love living in London, this is exactly where I want to be.'  vs  2025-08-10: 'I have to get out of London, this city is suffocating me.'  → appraisal contradiction; topic 'whether London is where I belong'",
    "- 2025-01-15: 'I'm a runner.'  vs  2025-07-20: 'I'm not really an athlete, I never was.'  → identity contradiction",
    "",
    "Contradiction kinds (pick the dominant frame):",
    "  preference   — I like X / I don't like X",
    "  belief       — I think X is true / I no longer think X",
    "  claim        — factual statement vs contradicting factual statement",
    "  commitment   — I'm going to do X / I'm not going to do X",
    "  identity     — I'm a person who X / I'm not that person",
    "  value        — X matters to me / X doesn't really matter",
    "  desire       — I want X / I don't want X",
    "  appraisal    — judgment of a thing/place/person reversed",
    "",
    "TOPIC: a 4-120 char phrase naming the territory of the contradiction. Examples: 'how visible I want to be', 'whether I want a relationship', 'how much money matters', 'whether London is where I belong'. The topic should let the user RECOGNISE the contradiction at a glance.",
    "",
    "CHARGE 1-5: how big is this contradiction?",
    "  1 — small preference flip (which coffee I prefer)",
    "  2 — minor stance change",
    "  3 — substantive change in a real area",
    "  4 — heavy contradiction touching identity / values / direction",
    "  5 — load-bearing contradiction — at the level of who you are",
    "",
    "DAYS_APART: not your responsibility to compute — server does it from the dates. But reject pairs where statement_a_date and statement_b_date are LESS THAN 7 DAYS apart (those are usually mood-of-the-moment, not contradiction).",
    "",
    "Output strict JSON ONLY:",
    `{"contradictions": [{"statement_a":"<earlier statement, ≤380 chars>", "statement_a_msg_id":"<msg_id>", "statement_b":"<later statement, ≤380 chars>", "statement_b_msg_id":"<msg_id>", "topic":"<4-120 char phrase>", "contradiction_kind":"<kind>", "domain":"<domain>", "charge": 1-5, "confidence": 1-5}]}`,
    "",
    "Rules:",
    "- statement_a_msg_id MUST be EARLIER chronologically than statement_b_msg_id. Use the [date|msg_id|...] tags.",
    "- statement_a and statement_b should be SUMMARISED in the user's voice — quote the key phrase but you can compress around it. ≤380 chars each.",
    "- contradiction_kind: ONE of preference/belief/claim/commitment/identity/value/desire/appraisal.",
    "- domain: ONE of work/health/relationships/family/finance/creative/self/spiritual/other.",
    "- topic: 4-120 chars; specific; lets the user recognise it.",
    "- charge: 1-5 as above.",
    "- confidence: 1-5; how sure you are these two statements actually contradict.",
    "",
    "DO NOT extract:",
    "- pairs less than 7 days apart (likely mood/context, not contradiction).",
    "- pairs where one statement was clearly hypothetical / asked rhetorically.",
    "- pairs where the user explicitly acknowledged the change ('I used to feel X but now I feel Y' is GROWTH NARRATED, not a hidden contradiction).",
    "- weak pairs where the topics aren't actually the same.",
    "- duplicate contradictions covering the same territory — pick the strongest pair.",
    "- soft contradictions that aren't really contradictions, just nuance.",
    "",
    "Quality over quantity. Aim for 3-10 contradictions. Each must be defensible as a real cross-time inconsistency the user would recognise. British English. No em-dashes.",
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

  let parsed: { contradictions?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.contradictions)) {
    return NextResponse.json({ error: "model output missing contradictions array" }, { status: 502 });
  }

  type ParsedC = {
    statement_a?: unknown;
    statement_a_msg_id?: unknown;
    statement_b?: unknown;
    statement_b_msg_id?: unknown;
    topic?: unknown;
    contradiction_kind?: unknown;
    domain?: unknown;
    charge?: unknown;
    confidence?: unknown;
  };

  type ValidC = {
    statement_a: string;
    statement_a_date: string;
    statement_a_msg_id: string;
    statement_b: string;
    statement_b_date: string;
    statement_b_msg_id: string;
    topic: string;
    contradiction_kind: string;
    domain: string;
    charge: number;
    confidence: number;
    days_apart: number;
  };

  const valid: ValidC[] = [];
  for (const c of parsed.contradictions as ParsedC[]) {
    const aText = typeof c.statement_a === "string" ? c.statement_a.trim().slice(0, 400) : "";
    const bText = typeof c.statement_b === "string" ? c.statement_b.trim().slice(0, 400) : "";
    const aId = typeof c.statement_a_msg_id === "string" ? c.statement_a_msg_id.trim() : "";
    const bId = typeof c.statement_b_msg_id === "string" ? c.statement_b_msg_id.trim() : "";
    const topic = typeof c.topic === "string" ? c.topic.trim().slice(0, 120) : "";
    const kind = typeof c.contradiction_kind === "string" && VALID_KINDS.has(c.contradiction_kind) ? c.contradiction_kind : null;
    const domain = typeof c.domain === "string" && VALID_DOMAINS.has(c.domain) ? c.domain : null;
    const charge = typeof c.charge === "number" ? Math.max(1, Math.min(5, Math.round(c.charge))) : 3;
    const confidence = typeof c.confidence === "number" ? Math.max(1, Math.min(5, Math.round(c.confidence))) : 3;

    if (!kind || !domain) continue;
    if (aText.length < 4 || bText.length < 4) continue;
    if (topic.length < 4) continue;
    if (confidence < 2) continue;
    if (!aId || !msgDates.has(aId)) continue;
    if (!bId || !msgDates.has(bId)) continue;
    if (aId === bId) continue;

    let aDate = msgDates.get(aId) as string;
    let bDate = msgDates.get(bId) as string;
    let aIdFinal = aId;
    let bIdFinal = bId;
    let aTextFinal = aText;
    let bTextFinal = bText;
    // Ensure (a, b) is (older, newer). If model swapped the order, swap back.
    if (aDate > bDate) {
      [aDate, bDate] = [bDate, aDate];
      [aIdFinal, bIdFinal] = [bIdFinal, aIdFinal];
      [aTextFinal, bTextFinal] = [bTextFinal, aTextFinal];
    }
    const daysApart = daysBetween(aDate, bDate);
    if (daysApart < 7) continue;

    valid.push({
      statement_a: aTextFinal,
      statement_a_date: aDate,
      statement_a_msg_id: aIdFinal,
      statement_b: bTextFinal,
      statement_b_date: bDate,
      statement_b_msg_id: bIdFinal,
      topic,
      contradiction_kind: kind,
      domain,
      charge,
      confidence,
      days_apart: daysApart,
    });
  }

  if (valid.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no qualifying contradictions detected", latency_ms: Date.now() - t0 });
  }

  const scanId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const latencyMs = Date.now() - t0;

  // Dedup by exact (a_msg_id, b_msg_id) pair. Fetch existing pairs first
  // and skip duplicates rather than rely on UPSERT — same pair shouldn't
  // be re-inserted, and we want the scan to be idempotent.
  const aIds = valid.map((v) => v.statement_a_msg_id);
  const bIds = valid.map((v) => v.statement_b_msg_id);
  const { data: existingRows } = await supabase
    .from("contradictions")
    .select("statement_a_msg_id, statement_b_msg_id")
    .eq("user_id", user.id)
    .in("statement_a_msg_id", aIds)
    .in("statement_b_msg_id", bIds);
  const existingPairs = new Set<string>();
  for (const r of (existingRows ?? [])) {
    existingPairs.add(`${r.statement_a_msg_id}|${r.statement_b_msg_id}`);
  }

  let inserted = 0;
  let skipped = 0;
  const insertedRows: Array<Record<string, unknown>> = [];

  for (const v of valid) {
    const key = `${v.statement_a_msg_id}|${v.statement_b_msg_id}`;
    if (existingPairs.has(key)) { skipped++; continue; }

    const { data: insRow, error: insErr } = await supabase
      .from("contradictions")
      .insert({
        user_id: user.id,
        scan_id: scanId,
        statement_a: v.statement_a,
        statement_a_date: v.statement_a_date,
        statement_a_msg_id: v.statement_a_msg_id,
        statement_b: v.statement_b,
        statement_b_date: v.statement_b_date,
        statement_b_msg_id: v.statement_b_msg_id,
        topic: v.topic,
        contradiction_kind: v.contradiction_kind,
        domain: v.domain,
        charge: v.charge,
        confidence: v.confidence,
        days_apart: v.days_apart,
        latency_ms: latencyMs,
        model,
      })
      .select("id, scan_id, statement_a, statement_a_date, statement_a_msg_id, statement_b, statement_b_date, statement_b_msg_id, topic, contradiction_kind, domain, charge, confidence, days_apart, status, resolution_note, resolved_at, pinned, archived_at, created_at, updated_at")
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
    contradictions: insertedRows,
    latency_ms: latencyMs,
    signals: {
      sampled: sampled.length,
      emitted: valid.length,
      already_seen: existingPairs.size,
    },
  });
}

export async function GET() {
  return NextResponse.json({ error: "POST only" }, { status: 405 });
}
