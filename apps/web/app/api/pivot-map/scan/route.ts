// POST /api/pivot-map/scan — Pivot Map (§159).
//
// Body: { window_days?: 30-365 (default 120) }
//
// Two-phase mining:
//   Phase 1 — find PIVOT MOMENTS in the user's own messages: explicit verbal
//     pivots ("actually", "scrap that", "new plan"), thematic pivots (warm
//     last week / cold this week — model finds these), stance reversals
//     ("I was wrong about X"), abandonments ("I'm dropping the X idea"),
//     recommitments ("I'm going back to X seriously this time"). Haiku extracts
//     pivot_text, pivot_kind, domain, from_state, to_state, from/to aliases.
//   Phase 2 — server-side: for each pivot, count subsequent messages that
//     mention from_aliases (back_slide) vs to_aliases (follow_through). Derive
//     pivot_quality: stuck / performed / reverted / quiet / too_recent.
//
// dedup by (user_id, pivot_message_id) so re-scans don't flood.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 4000;

const VALID_KINDS = new Set([
  "verbal", "thematic", "stance_reversal", "abandonment", "recommitment",
]);

const VALID_DOMAINS = new Set([
  "work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other",
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

  const windowDays = Math.max(30, Math.min(365, Math.round(body.window_days ?? 120)));

  const t0 = Date.now();
  const startIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const todayDate = dateOnly(new Date().toISOString());
  const startDate = dateOnly(startIso);

  const { data: msgRows, error: msgErr } = await supabase
    .from("messages")
    .select("id, conversation_id, content, created_at, role")
    .eq("user_id", user.id)
    .gte("created_at", startIso)
    .order("created_at", { ascending: true })
    .limit(2500);
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  type Msg = { id: string; conversation_id: string; content: string; created_at: string; role: string };
  const allMessages = (msgRows ?? []) as Msg[];
  const userMessages = allMessages.filter((m) => m.role === "user");

  if (userMessages.length < 30) {
    return NextResponse.json({ error: "not enough chat history in this window — try a longer window" }, { status: 400 });
  }

  // Phase 1 pre-filter: messages with potential pivot language.
  const PIVOT_RE = /\b(actually,?|scrap that|forget (?:that|what i said)|on (?:reflection|second thought|reconsidering)|i'?ve changed my mind|i changed my mind|i'?m changing my mind|i'?ve been (?:wrong|thinking)|i was wrong (?:about|to)|let me reconsider|new plan|now i think|instead,? (?:i|we|let)|or rather|wait,?[ \-]+|rethink(?:ing)?|different direction|u-?turn|i'?m pivoting|pivot(?:ing)? (?:on|to|from)|i'?m (?:dropping|abandoning|killing) (?:the |this |that )?\w|i'?m going back to|i'?ve (?:decided|realised|realized) (?:i'?m|to|that i should)|i'?m no longer (?:going|trying|building|chasing)|new direction|180|complete (?:reversal|switch|flip)|i flipped|i'?m flipping|on the contrary|that was wrong|i'?ve recommitted|i'?m recommitting|properly this time|seriously this time|for real this time|i'?m starting over|reset|fresh start|in fact,?|i'?ve come (?:round|around) to|i'?ve come back to)\b/i;
  const candidates = userMessages.filter((m) => PIVOT_RE.test(m.content) && m.content.length >= 25);

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no pivot moments found in this window", latency_ms: Date.now() - t0 });
  }

  const trimmed = candidates.map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    created_at: m.created_at,
    snippet: m.content.length > 400 ? m.content.slice(0, 360) + " ..." : m.content,
  }));

  const SAMPLE_LIMIT = 130;
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
  lines.push(`PIVOT-LIKE CANDIDATE MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting PIVOT MOMENTS from the user's own messages. A pivot moment is an inflection point where the user CHANGED DIRECTION on something — a stance, a project, a behaviour, an identity, a decision.",
    "",
    "Five kinds of pivot:",
    "  verbal — the user explicitly says they're changing direction (\"actually, scrap that, let's go with X\", \"I've changed my mind on Y\", \"new plan\")",
    "  thematic — a topic that was hot/warm earlier in the window has gone cold, or vice versa, and the message is the moment of turning",
    "  stance_reversal — the user explicitly reverses a previously held stance (\"I was wrong about X\", \"I've come round to X\", \"on reflection X is right\")",
    "  abandonment — the user is dropping/killing something they were doing or planning (\"I'm killing the X idea\", \"dropping the agency project\", \"no longer chasing Y\")",
    "  recommitment — the user is going BACK to something with renewed intent (\"I'm going back to X properly this time\", \"recommitting to Y\", \"starting Z over for real\")",
    "",
    "Output strict JSON ONLY:",
    `{"pivots": [{"pivot_text":"...", "pivot_kind":"...", "domain":"...", "from_state":"...", "to_state":"...", "from_aliases":["..."], "to_aliases":["..."], "confidence": 1-5, "msg_id":"..."}]}`,
    "",
    "Rules:",
    "- pivot_text: verbatim quote of the inflection moment from the message. ≤260 chars. Don't paraphrase. Pick the SENTENCE that contains the turn, not the whole message.",
    "- pivot_kind: ONE of verbal | thematic | stance_reversal | abandonment | recommitment. Pick the sharpest match.",
    "- domain: ONE of work | relationships | health | identity | finance | creative | learning | daily | other. work for projects/business/career; relationships for people/social; health for body/sleep/energy/exercise; identity for self-concept/values/who-I-am; finance for money; creative for art/design/writing/music; learning for skill acquisition; daily for routines/habits/admin; other for everything else.",
    "- from_state: ONE LINE describing what the user was DOING/BELIEVING/WANTING BEFORE the pivot. Specific. Examples: 'building a B2B agency for fintech clients', 'living off coffee and 4 hours sleep', 'thinking JARVIS should be a chat tool'.",
    "- to_state: ONE LINE describing what the user is shifting TOWARD. Same shape. Examples: 'building a solo product instead', 'committing to 8 hours sleep nightly', 'reframing JARVIS as a general web agent'.",
    "- from_aliases: 1-5 noun phrases that would identify the OLD direction in subsequent messages. Examples for from_state 'building a B2B agency for fintech clients': ['agency', 'B2B agency', 'fintech clients', 'agency project']. Pick aliases SPECIFIC enough to not false-match generic words like 'work' or 'project' on their own.",
    "- to_aliases: 1-5 noun phrases that would identify the NEW direction in subsequent messages. Same shape.",
    "- confidence: 1-5. 5 = pivot is unmistakable and concrete. 1 = ambiguous, might just be hedging.",
    "- msg_id: EXACT msg_id from the [date|msg_id|conv:...] tag. Copy verbatim.",
    "",
    "DO NOT extract:",
    "- Mere disagreement with someone else's idea (must be the user changing their OWN direction)",
    "- Hypothetical pivots (\"if I were to scrap X\")",
    "- Pure operational corrections (\"actually, the file is at /tmp/y not /tmp/x\" — that's typo correction, not life pivot)",
    "- Trivial micro-pivots (\"actually let's order pizza instead of sushi\" — too small)",
    "- Multiple pivots in one message — split into separate entries",
    "- Same pivot twice across multiple sampled messages — pick the cleanest moment",
    "",
    "British English. No em-dashes. Be honest. Don't invent pivots that aren't in the messages. Quality over quantity — 4 sharp pivots beat 20 vague ones.",
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

  let parsed: { pivots?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.pivots)) {
    return NextResponse.json({ error: "model output missing pivots array" }, { status: 502 });
  }

  type ParsedPivot = {
    pivot_text?: unknown;
    pivot_kind?: unknown;
    domain?: unknown;
    from_state?: unknown;
    to_state?: unknown;
    from_aliases?: unknown;
    to_aliases?: unknown;
    confidence?: unknown;
    msg_id?: unknown;
  };

  type ValidPivot = {
    pivot_text: string;
    pivot_kind: string;
    domain: string;
    from_state: string;
    to_state: string;
    from_aliases: string[];
    to_aliases: string[];
    confidence: number;
    pivot_date: string;
    pivot_message_id: string;
    pivot_conversation_id: string | null;
  };

  const validPivots: ValidPivot[] = [];
  for (const p of parsed.pivots as ParsedPivot[]) {
    const pivotText = typeof p.pivot_text === "string" ? p.pivot_text.trim().slice(0, 360) : "";
    const pivotKind = typeof p.pivot_kind === "string" && VALID_KINDS.has(p.pivot_kind) ? p.pivot_kind : null;
    const domain = typeof p.domain === "string" && VALID_DOMAINS.has(p.domain) ? p.domain : null;
    const fromState = typeof p.from_state === "string" ? p.from_state.trim().slice(0, 240) : "";
    const toState = typeof p.to_state === "string" ? p.to_state.trim().slice(0, 240) : "";
    const fromAliasesRaw = Array.isArray(p.from_aliases) ? p.from_aliases : [];
    const toAliasesRaw = Array.isArray(p.to_aliases) ? p.to_aliases : [];
    const fromAliases = fromAliasesRaw
      .filter((a): a is string => typeof a === "string")
      .map((a) => a.trim().slice(0, 60))
      .filter((a) => a.length >= 2)
      .slice(0, 5);
    const toAliases = toAliasesRaw
      .filter((a): a is string => typeof a === "string")
      .map((a) => a.trim().slice(0, 60))
      .filter((a) => a.length >= 2)
      .slice(0, 5);
    const confidence = typeof p.confidence === "number" ? Math.max(1, Math.min(5, Math.round(p.confidence))) : 3;
    const msgId = typeof p.msg_id === "string" ? p.msg_id.trim() : "";

    if (!pivotKind || !domain || pivotText.length < 8 || fromState.length < 4 || toState.length < 4) continue;
    if (fromAliases.length === 0 && toAliases.length === 0) continue;
    if (!msgId || !msgDates.has(msgId)) continue;

    validPivots.push({
      pivot_text: pivotText,
      pivot_kind: pivotKind,
      domain,
      from_state: fromState,
      to_state: toState,
      from_aliases: fromAliases,
      to_aliases: toAliases,
      confidence,
      pivot_date: msgDates.get(msgId) as string,
      pivot_message_id: msgId,
      pivot_conversation_id: msgConvos.get(msgId) ?? null,
    });
  }

  if (validPivots.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no qualifying pivot moments detected", latency_ms: Date.now() - t0 });
  }

  // Phase 2: count follow-through and back-slide for each pivot.
  // Walk all messages (user + assistant) AFTER pivot_date.
  const yearAgoIso = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const { data: existingRows } = await supabase
    .from("pivots")
    .select("pivot_message_id")
    .eq("user_id", user.id)
    .gte("created_at", yearAgoIso);
  const existingMsgIds = new Set(
    ((existingRows ?? []) as Array<{ pivot_message_id: string | null }>)
      .map((r) => r.pivot_message_id)
      .filter((s): s is string => typeof s === "string"),
  );

  const scanId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const latencyMs = Date.now() - t0;
  const todayMs = Date.now();

  type SampleRow = { date: string; snippet: string };

  type Insert = {
    user_id: string;
    scan_id: string;
    pivot_text: string;
    pivot_kind: string;
    domain: string;
    pivot_date: string;
    pivot_message_id: string;
    pivot_conversation_id: string | null;
    from_state: string;
    to_state: string;
    from_aliases: string[];
    to_aliases: string[];
    days_since_pivot: number;
    follow_through_count: number;
    follow_through_days: number;
    back_slide_count: number;
    back_slide_days: number;
    follow_through_samples: SampleRow[];
    back_slide_samples: SampleRow[];
    pivot_quality: string;
    confidence: number;
    latency_ms: number;
    model: string;
  };

  const toInsert: Insert[] = [];
  const MAX_SAMPLES = 5;

  function buildRegex(terms: string[]): RegExp | null {
    const filtered = terms.filter((t) => t.length >= 2);
    if (filtered.length === 0) return null;
    const escaped = filtered.map(escapeRegex);
    return new RegExp(`(?<![A-Za-z])(${escaped.join("|")})(?![A-Za-z])`, "i");
  }

  function snippetAt(content: string, re: RegExp): string {
    const idx = content.search(re);
    if (idx < 0) return content.slice(0, 200);
    const start = Math.max(0, idx - 60);
    const end = Math.min(content.length, idx + 120);
    const snip = (start > 0 ? "..." : "") + content.slice(start, end).replace(/\n+/g, " ") + (end < content.length ? "..." : "");
    return snip.slice(0, 200);
  }

  for (const pivot of validPivots) {
    if (existingMsgIds.has(pivot.pivot_message_id)) continue;

    const pivotMs = new Date(pivot.pivot_date + "T23:59:59.999Z").getTime();
    const daysSincePivot = Math.max(0, Math.round((todayMs - pivotMs) / 86_400_000));

    const reFrom = buildRegex(pivot.from_aliases);
    const reTo = buildRegex(pivot.to_aliases);

    const fromHits: SampleRow[] = [];
    const toHits: SampleRow[] = [];
    const fromDays = new Set<string>();
    const toDays = new Set<string>();

    for (const m of allMessages) {
      const ms = new Date(m.created_at).getTime();
      if (ms <= pivotMs) continue;
      if (m.id === pivot.pivot_message_id) continue;
      const d = dateOnly(m.created_at);
      if (reFrom && reFrom.test(m.content)) {
        fromDays.add(d);
        fromHits.push({ date: d, snippet: snippetAt(m.content, reFrom) });
      }
      if (reTo && reTo.test(m.content)) {
        toDays.add(d);
        toHits.push({ date: d, snippet: snippetAt(m.content, reTo) });
      }
    }

    const followSamples = toHits.slice(-MAX_SAMPLES).reverse();
    const slideSamples = fromHits.slice(-MAX_SAMPLES).reverse();

    let quality: string;
    if (daysSincePivot < 7) quality = "too_recent";
    else if (toHits.length >= 3 && toHits.length >= fromHits.length * 2) quality = "stuck";
    else if (fromHits.length > toHits.length && fromHits.length >= 2) quality = "reverted";
    else if (toHits.length <= 1 && fromHits.length <= 1) quality = "performed";
    else quality = "quiet";

    toInsert.push({
      user_id: user.id,
      scan_id: scanId,
      pivot_text: pivot.pivot_text,
      pivot_kind: pivot.pivot_kind,
      domain: pivot.domain,
      pivot_date: pivot.pivot_date,
      pivot_message_id: pivot.pivot_message_id,
      pivot_conversation_id: pivot.pivot_conversation_id,
      from_state: pivot.from_state,
      to_state: pivot.to_state,
      from_aliases: pivot.from_aliases,
      to_aliases: pivot.to_aliases,
      days_since_pivot: daysSincePivot,
      follow_through_count: toHits.length,
      follow_through_days: toDays.size,
      back_slide_count: fromHits.length,
      back_slide_days: fromDays.size,
      follow_through_samples: followSamples,
      back_slide_samples: slideSamples,
      pivot_quality: quality,
      confidence: pivot.confidence,
      latency_ms: latencyMs,
      model,
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, scan_id: scanId, inserted: 0, message: "no new pivot moments — every detected pivot was already on file", latency_ms: latencyMs });
  }

  const { data: inserted, error } = await supabase
    .from("pivots")
    .insert(toInsert)
    .select("id, scan_id, pivot_text, pivot_kind, domain, pivot_date, pivot_message_id, pivot_conversation_id, from_state, to_state, from_aliases, to_aliases, days_since_pivot, follow_through_count, follow_through_days, back_slide_count, back_slide_days, follow_through_samples, back_slide_samples, pivot_quality, confidence, status, status_note, pinned, archived_at, latency_ms, model, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: inserted?.length ?? 0,
    pivots: inserted ?? [],
    latency_ms: latencyMs,
    signals: {
      total_messages: allMessages.length,
      pivot_candidates: candidates.length,
      pivots_extracted: validPivots.length,
    },
  });
}
