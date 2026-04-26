// POST /api/phantom-limbs/scan — Phantom Limb Detector (§158).
//
// Body: { window_days?: 30-365 (default 180) }
//
// Two-phase mining:
//   Phase 1 — find "moved-on claims" the user has made: "I'm done with X",
//     "I've moved on from Y", "I no longer think about Z", "I let go of W".
//     Use Haiku to extract the claim + the topic + alias hints.
//   Phase 2 — for each topic, count how many times the user has mentioned it
//     in subsequent messages. The topic is real if mentions > threshold.
//     This is the haunting count — the phantom limb.
//
// One row per (claim, topic) pair. dedup by (user_id, topic, claim_date)
// against existing rows so re-scans don't flood.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 3600;

const VALID_KINDS = new Set([
  "done_with", "moved_on", "let_go", "no_longer_thinking",
  "finished", "past_it", "not_my_problem", "put_down",
]);

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function dateOnly(iso: string): string { return iso.slice(0, 10); }

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { window_days?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const windowDays = Math.max(30, Math.min(365, Math.round(body.window_days ?? 180)));

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
    .order("created_at", { ascending: true })
    .limit(2000);
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  const messages = (msgRows ?? []) as Array<{ id: string; conversation_id: string; content: string; created_at: string }>;

  if (messages.length < 30) {
    return NextResponse.json({ error: "not enough chat history in this window — try a longer window" }, { status: 400 });
  }

  // Phase 1: filter to messages with "moved-on claim" language.
  const MOVE_ON_RE = /\b(i'?m done (?:with|thinking about)|i'?m over|i'?ve (?:moved on|let go|gotten past|put down|put behind me)|i no longer (?:think about|care about|worry about)|i don'?t (?:think about|care about|worry about|miss)|i'?m past|i'?ve made peace with|that'?s in the past|i'?ve dropped|that chapter is closed|that'?s behind me|i'?ve stopped (?:thinking about|caring about|worrying about)|i'?ve finally (?:moved on|let go)|that'?s no longer my (?:problem|concern)|i'?m not (?:that person|him|her|them) anymore|i refuse to (?:think|care|worry) about|i'?ve buried|that ship has sailed)\b/i;
  const claims = messages.filter((m) => MOVE_ON_RE.test(m.content));

  if (claims.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no move-on claims found in this window", latency_ms: Date.now() - t0 });
  }

  // Trim claim candidates to manageable size.
  const trimmedClaims = claims.map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    created_at: m.created_at,
    snippet: m.content.length > 360 ? m.content.slice(0, 320) + " ..." : m.content,
  }));

  const SAMPLE_LIMIT = 120;
  const sampledClaims: typeof trimmedClaims = [];
  if (trimmedClaims.length <= SAMPLE_LIMIT) {
    sampledClaims.push(...trimmedClaims);
  } else {
    const step = trimmedClaims.length / SAMPLE_LIMIT;
    for (let i = 0; i < SAMPLE_LIMIT; i += 1) {
      const idx = Math.floor(i * step);
      const item = trimmedClaims[idx];
      if (item) sampledClaims.push(item);
    }
  }
  sampledClaims.sort((a, b) => a.created_at.localeCompare(b.created_at));

  const claimMsgDates = new Map<string, string>();
  const claimMsgConvos = new Map<string, string>();
  for (const m of sampledClaims) {
    claimMsgDates.set(m.id, dateOnly(m.created_at));
    claimMsgConvos.set(m.id, m.conversation_id);
  }

  const claimLines: string[] = [];
  claimLines.push(`WINDOW: ${startDate} → ${todayDate} (${windowDays} days)`);
  claimLines.push(`MOVE-ON CLAIM CANDIDATES: ${sampledClaims.length}`);
  claimLines.push("");
  claimLines.push("MESSAGES CONTAINING POSSIBLE MOVE-ON CLAIMS (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampledClaims) {
    claimLines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  claimLines.push("");

  const system = [
    "You are extracting MOVE-ON CLAIMS from the user's own messages. A move-on claim is a statement where the user CLAIMS to have moved past, finished with, let go of, or no longer be affected by some specific topic, person, project, behaviour, identity, or feeling.",
    "",
    "Linguistic markers: 'I'm done with X', 'I'm over X', 'I've moved on from Y', 'I no longer think about Z', 'I let go of W', 'I've stopped caring about V', 'I've put U behind me', 'that chapter is closed', 'I'm past it', 'that ship has sailed', 'I'm not that person anymore', 'I've buried Q', 'I refuse to worry about R', 'I've made peace with P'.",
    "",
    "Output strict JSON ONLY:",
    `{"claims": [{"claim_text":"...", "claim_kind":"...", "topic":"...", "topic_aliases":["..."], "msg_id":"..."}]}`,
    "",
    "Rules:",
    "- claim_text: verbatim sentence/fragment of the move-on claim from the user's message. ≤240 chars. Don't paraphrase.",
    "- claim_kind: ONE of done_with | moved_on | let_go | no_longer_thinking | finished | past_it | not_my_problem | put_down. Pick the closest semantic match — done_with for 'I'm done with X' / 'I'm over X', moved_on for 'moved on from', let_go for 'let go' / 'released', no_longer_thinking for 'no longer think about' / 'don't think about', finished for 'I'm finished with' / 'that chapter is closed' / 'that ship has sailed', past_it for 'past it' / 'in the past' / 'behind me', not_my_problem for 'not my problem' / 'no longer my concern', put_down for 'I've put down' / 'I've buried' / 'I've dropped'.",
    "- topic: the SPECIFIC noun or noun phrase the user claims to have moved on from. Should be 1-4 words. Examples: 'Sarah', 'the agency project', 'drinking', 'building physical products', 'my old company', 'investor outreach'. PICK THE SHARPEST POSSIBLE — if the user says 'I'm completely done with the agency project that's been weighing on me', topic is 'the agency project'.",
    "- topic_aliases: 1-5 alias strings the user might use to refer to the same topic. Examples: for topic 'the agency project' aliases might be ['agency', 'the agency', 'the project', 'agency work']. For 'Sarah' aliases might be ['Sarah'] (if no other names obvious). For 'drinking' aliases might be ['drink', 'drinking', 'alcohol', 'wine', 'pints']. KEEP IT SHORT and choose aliases that are not so common they'd false-match (e.g. don't alias 'work' for an agency project — too generic).",
    "- msg_id: EXACT msg_id from the [date|msg_id|conv:...] tag. Copy from the tag.",
    "",
    "DO NOT extract:",
    "- Generic statements without a topic ('I've moved on' with no object — useless)",
    "- Promises about future ('I will let go of X' — that's a promise, not a move-on claim)",
    "- Hypotheticals ('if I let go of X')",
    "- Multiple topics in one claim — split into separate entries",
    "- Same topic + same message twice",
    "- Move-on claims where the topic is clearly trivial ('I'm done with this email', 'I'm done with the meeting' — only extract if the topic is something the user has been emotionally working through)",
    "",
    "If the same message contains 2 separate move-on claims about different topics, return both as separate entries.",
    "",
    "British English. No em-dashes. Be honest. Don't invent claims that aren't in the messages.",
  ].join("\n");

  const userMsg = ["EVIDENCE:", "", claimLines.join("\n")].join("\n");

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

  let parsed: { claims?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.claims)) {
    return NextResponse.json({ error: "model output missing claims array" }, { status: 502 });
  }

  type ParsedClaim = {
    claim_text?: unknown;
    claim_kind?: unknown;
    topic?: unknown;
    topic_aliases?: unknown;
    msg_id?: unknown;
  };

  type ValidClaim = {
    claim_text: string;
    claim_kind: string;
    topic: string;
    topic_aliases: string[];
    claim_date: string;
    claim_message_id: string;
    claim_conversation_id: string | null;
  };

  const validClaims: ValidClaim[] = [];
  for (const c of parsed.claims as ParsedClaim[]) {
    const claimText = typeof c.claim_text === "string" ? c.claim_text.trim().slice(0, 320) : "";
    const claimKind = typeof c.claim_kind === "string" && VALID_KINDS.has(c.claim_kind) ? c.claim_kind : null;
    const topic = typeof c.topic === "string" ? c.topic.trim().slice(0, 80) : "";
    const aliasesRaw = Array.isArray(c.topic_aliases) ? c.topic_aliases : [];
    const aliases = aliasesRaw
      .filter((a): a is string => typeof a === "string")
      .map((a) => a.trim().slice(0, 60))
      .filter((a) => a.length >= 2)
      .slice(0, 5);
    const msgId = typeof c.msg_id === "string" ? c.msg_id.trim() : "";

    if (!claimKind || claimText.length < 8 || topic.length < 2) continue;
    if (!msgId || !claimMsgDates.has(msgId)) continue;

    validClaims.push({
      claim_text: claimText,
      claim_kind: claimKind,
      topic,
      topic_aliases: aliases,
      claim_date: claimMsgDates.get(msgId) as string,
      claim_message_id: msgId,
      claim_conversation_id: claimMsgConvos.get(msgId) ?? null,
    });
  }

  if (validClaims.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no qualifying move-on claims detected", latency_ms: Date.now() - t0 });
  }

  // Phase 2: count post-claim mentions of each topic in the messages stream.
  // We scan the SAME message set (stream is chronological ascending). For each
  // claim, search messages with created_at > claim_date for any of topic +
  // aliases, case-insensitive whole-word. Skip the claim message itself.
  type MentionRow = { date: string; snippet: string; msg_id: string };

  // Pull existing phantom_limbs to dedup
  const yearAgoIso = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const { data: existingRows } = await supabase
    .from("phantom_limbs")
    .select("topic, claim_date")
    .eq("user_id", user.id)
    .gte("created_at", yearAgoIso);
  const existingKeys = new Set(
    ((existingRows ?? []) as Array<{ topic: string; claim_date: string }>).map((r) =>
      `${r.topic.toLowerCase()}|${r.claim_date}`,
    ),
  );

  const scanId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const latencyMs = Date.now() - t0;

  type Insert = {
    user_id: string;
    scan_id: string;
    topic: string;
    topic_aliases: string[];
    claim_text: string;
    claim_kind: string;
    claim_date: string;
    claim_message_id: string;
    claim_conversation_id: string | null;
    days_since_claim: number;
    post_mention_count: number;
    post_mention_days: number;
    post_mentions: MentionRow[];
    haunting_score: number;
    latency_ms: number;
    model: string;
  };
  const toInsert: Insert[] = [];

  const todayMs = Date.now();
  const MAX_POST_MENTIONS_RECORDED = 8;

  for (const claim of validClaims) {
    const dedupKey = `${claim.topic.toLowerCase()}|${claim.claim_date}`;
    if (existingKeys.has(dedupKey)) continue;

    const claimMs = new Date(claim.claim_date + "T23:59:59.999Z").getTime();

    // Build a regex from topic + aliases — whole word match, case-insensitive.
    const terms = [claim.topic, ...claim.topic_aliases].filter((t) => t.length >= 2);
    if (terms.length === 0) continue;
    const escaped = terms.map(escapeRegex);
    // Word boundary that handles the start/end and treats apostrophes as word chars.
    const re = new RegExp(`(?<![A-Za-z])(${escaped.join("|")})(?![A-Za-z])`, "i");

    const postMentions: MentionRow[] = [];
    const postMentionDates = new Set<string>();
    for (const m of messages) {
      const ms = new Date(m.created_at).getTime();
      if (ms <= claimMs) continue;
      if (m.id === claim.claim_message_id) continue;
      if (!re.test(m.content)) continue;
      const d = dateOnly(m.created_at);
      postMentionDates.add(d);
      // Pull a snippet centred on the match
      const idx = m.content.search(re);
      const start = Math.max(0, idx - 60);
      const end = Math.min(m.content.length, idx + 120);
      const snippet = (start > 0 ? "..." : "") + m.content.slice(start, end).replace(/\n+/g, " ") + (end < m.content.length ? "..." : "");
      postMentions.push({ date: d, snippet: snippet.slice(0, 200), msg_id: m.id });
    }

    // Keep the most recent N mentions (we walked ascending — take last N)
    const recentMentions = postMentions.slice(-MAX_POST_MENTIONS_RECORDED).reverse();

    // Skip if barely any haunting — phantom limb requires actual haunting
    if (postMentions.length < 2) continue;

    const daysSinceClaim = Math.max(0, Math.round((todayMs - claimMs) / 86_400_000));

    // Haunting score: combine count + recency + days span
    // 5: ≥10 mentions OR ≥5 mentions in last 14 days
    // 4: ≥6 mentions
    // 3: ≥4 mentions
    // 2: ≥3 mentions
    // 1: 2 mentions
    let hauntingScore: number;
    const recentMentionsLast14 = postMentions.filter((m) => {
      const ms = new Date(m.date + "T12:00:00.000Z").getTime();
      return todayMs - ms <= 14 * 86_400_000;
    }).length;
    if (postMentions.length >= 10 || recentMentionsLast14 >= 5) hauntingScore = 5;
    else if (postMentions.length >= 6) hauntingScore = 4;
    else if (postMentions.length >= 4) hauntingScore = 3;
    else if (postMentions.length >= 3) hauntingScore = 2;
    else hauntingScore = 1;

    toInsert.push({
      user_id: user.id,
      scan_id: scanId,
      topic: claim.topic,
      topic_aliases: claim.topic_aliases,
      claim_text: claim.claim_text,
      claim_kind: claim.claim_kind,
      claim_date: claim.claim_date,
      claim_message_id: claim.claim_message_id,
      claim_conversation_id: claim.claim_conversation_id,
      days_since_claim: daysSinceClaim,
      post_mention_count: postMentions.length,
      post_mention_days: postMentionDates.size,
      post_mentions: recentMentions,
      haunting_score: hauntingScore,
      latency_ms: latencyMs,
      model,
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, scan_id: scanId, inserted: 0, message: "no phantom limbs detected — every move-on claim seems to have stuck", latency_ms: latencyMs });
  }

  const { data: inserted, error } = await supabase
    .from("phantom_limbs")
    .insert(toInsert)
    .select("id, scan_id, topic, topic_aliases, claim_text, claim_kind, claim_date, claim_message_id, claim_conversation_id, days_since_claim, post_mention_count, post_mention_days, post_mentions, haunting_score, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: inserted?.length ?? 0,
    phantom_limbs: inserted ?? [],
    latency_ms: latencyMs,
    signals: {
      total_messages: messages.length,
      claim_candidates: claims.length,
      claims_extracted: validClaims.length,
    },
  });
}
