// POST /api/permission-slips/scan — The Permission-Slips Ledger (§177).
//
// Body: { window_days?: 30-540 (default 180) }
//
// Mines the user's chats for PERMISSION-SLIPS — every "I can't" / "I'm not
// allowed to" / "I shouldn't be" / "it's not for me" / "I'm not the kind of
// person who" the user voices ABOUT THEMSELVES. Negative self-constraints —
// the things they refuse themselves.
//
// Distinct from §168 shoulds (felt obligations TO DO X — those demand action;
// permission-slips REFUSE action) and from §172 vows (positive self-authored
// rules — "I always" / "I never"; permission-slips are not principles but
// blocks).
//
// THE NOVEL HOOK is THE SIGNER. For every refusal, there's an implied
// authority that needs to grant permission. Most permission-slips have an
// implicit external signer the user hasn't noticed they're answering to:
// parents, partner, peers, profession, society, employer, circumstance.
// Surfacing that signer is half the move toward re-authorship.
//
// One Haiku call extracts permission-slips. For each: forbidden_action,
// signer (9-value enum), authority_text (optional), domain, charge 1-5,
// recency, confidence.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 5000;

const VALID_SIGNERS = new Set([
  "self", "parent", "partner", "peers", "society",
  "employer", "profession", "circumstance", "unknown",
]);
const VALID_DOMAINS = new Set([
  "work", "health", "relationships", "family", "finance",
  "creative", "self", "spiritual", "other",
]);
const VALID_RECENCY = new Set(["recent", "older"]);

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function dateOnly(iso: string): string { return iso.slice(0, 10); }

const TRIGGER_RE = /\b(i can'?t (?:just |really |actually )?(?:do|take|have|be|ask|say|let|allow|afford|justify|spend|rest|stop|leave|quit|start|write|make|try|enjoy|want|need|admit|show|wear|earn|keep|charge)|i'?m not allowed to|i'?m not (?:supposed|meant) to|i shouldn'?t (?:be|even|really|just)|it'?s not (?:for|allowed for|appropriate for|something for) (?:me|someone like me)|not for someone like me|i don'?t (?:get to|deserve to|have permission to)|who am i to|i have to (?:earn|prove|justify|wait|push through|deserve)|i can'?t justify|i can'?t really afford to|i (?:can'?t|shouldn'?t) rest until|i'?m not the (?:kind|type) of person who|people like me don'?t|that'?s not (?:for|something) (?:me|i do)|i need (?:permission|to ask) (?:to|first)|i can'?t (?:just )?(?:say no|stop|leave|walk away)|i can'?t let myself|i'?d feel (?:guilty|wrong|selfish) (?:if|to))\b/i;

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
    .limit(3000);
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  type Msg = { id: string; conversation_id: string; content: string; created_at: string };
  const userMessages = (msgRows ?? []) as Msg[];

  if (userMessages.length < 20) {
    return NextResponse.json({ error: "not enough chat history in this window — try a longer window" }, { status: 400 });
  }

  const candidates = userMessages.filter((m) =>
    TRIGGER_RE.test(m.content) &&
    m.content.length >= 20 &&
    m.content.length <= 3000,
  );

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no permission-slips detected in this window", latency_ms: Date.now() - t0 });
  }

  const trimmed = candidates.map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    created_at: m.created_at,
    snippet: m.content.length > 400 ? m.content.slice(0, 360) + " ..." : m.content,
  }));

  const SAMPLE_LIMIT = 140;
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
  lines.push(`PERMISSION-SLIP CANDIDATE MESSAGES: ${sampled.length}`);
  lines.push("");
  lines.push("MESSAGES (chronological — each tagged with [date|msg_id|conv:xxxxxxxx]):");
  for (const m of sampled) {
    lines.push(`- [${dateOnly(m.created_at)}|${m.id}|conv:${m.conversation_id.slice(0, 8)}] ${m.snippet.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  const system = [
    "You are extracting PERMISSION-SLIPS — every 'I can't' / 'I'm not allowed to' / 'I shouldn't be' / 'it's not for me' / 'I'm not the kind of person who' the user voices ABOUT THEMSELVES. The constraints they place NEGATIVELY on themselves.",
    "",
    "Distinct from:",
    "  Felt obligations ('I should call my mum') — those demand action FROM the user. Permission-slips REFUSE action.",
    "  Vows ('I always' / 'I never') — those are positive self-authored rules / principles. Permission-slips are not principles but BLOCKS.",
    "  Capability statements ('I can't speak Mandarin') — those are factual. Permission-slips are about what the user FORBIDS themselves, not what they're unable to do.",
    "",
    "Each permission-slip has these pieces:",
    "  forbidden_action — distilled phrasing of what the user says they can't / shouldn't / aren't allowed to do. ≤240 chars. Examples: 'take a sabbatical this year', 'write fiction', 'be the loud person in the room', 'ask for a raise', 'rest without earning it', 'leave a job before two years', 'spend on myself', 'wear what I want at work', 'turn down a client', 'admit when I'm struggling'.",
    "  signer — THE NOVEL DIAGNOSTIC FIELD. WHO holds the permission slip — who would have to grant permission for the user to do this thing? Read carefully:",
    "    self        — the user themselves is the only one in the way. Use SPARINGLY on first scan; usually the user only realises after reckoning. Pick this only when the user has already named themselves as the gate-keeper.",
    "    parent      — internalised parental voice. 'My dad never let us', 'mum would think', 'in my family we don't'.",
    "    partner     — current partner's expectations or assumed reaction.",
    "    peers       — peer group's silent norms. 'None of my friends do that', 'in my circle that's seen as'.",
    "    society     — diffuse 'people don't do that', 'you're supposed to'. Cultural script.",
    "    employer    — workplace, boss, or company culture. 'They wouldn't be happy if I'.",
    "    profession  — industry norms. 'You're not a real X if you Y', 'people in this field don't'.",
    "    circumstance — material facts (money, health, time, kids, mortgage). The constraint may genuinely be material — that's still a slip if the user is treating circumstance AS authority.",
    "    unknown     — model can't tell who the implied authority is.",
    "  authority_text — OPTIONAL. 4-160 chars phrasing of WHO/WHAT specifically is the authority, when nameable. Examples: 'my dad', 'the industry I'm in', 'my mortgage', 'the rules of investment journalism', 'what people at my office expect'. Null if not stated or not specific.",
    "",
    "  domain — work / health / relationships / family / finance / creative / self / spiritual / other.",
    "",
    "  charge — 1-5. How load-bearing this self-restriction is in the user's life:",
    "    1 — passing remark. ('I can't really do spicy food.')",
    "    2 — operative restriction. Real but not central.",
    "    3 — explicit block. The user has organised behaviour around this.",
    "    4 — load-bearing. A significant chunk of life shaped by this 'I can't'.",
    "    5 — identity-level. The user's sense of WHO THEY ARE rests on this refusal. Surfacing it is potentially destabilising.",
    "",
    "  recency — recent (mentioned recently) | older (referencing a long-standing pattern).",
    "",
    "  confidence — 1-5.",
    "",
    "Output strict JSON ONLY:",
    `{"permission_slips": [{"forbidden_action":"...", "signer":"self|parent|partner|peers|society|employer|profession|circumstance|unknown", "authority_text":"..."|null, "domain":"...", "charge": 1-5, "recency":"recent|older", "confidence": 1-5, "msg_id":"..."}]}`,
    "",
    "Rules:",
    "- forbidden_action: distilled, second-person-implicit, ≤240 chars. Capture the SHAPE of the refusal, not the literal words. 'take a sabbatical' not 'i can't take a sabbatical'. The grammar is: a thing the user is refusing themselves.",
    "- signer: ONE of the 9 values. Lean toward EXTERNAL signers (parent/partner/peers/society/employer/profession/circumstance) on first scan — the diagnostic value is in surfacing the implicit authority. Only mark 'self' if the user has explicitly framed it as their own choice. Mark 'unknown' if you can't tell.",
    "- authority_text: VERBATIM where possible. Null if no specific authority is named.",
    "- domain: ONE of the 9 valid domains.",
    "- charge: 1-5. Be conservative. Most permission-slips are 2-3.",
    "- recency: recent | older.",
    "- confidence: 1-5.",
    "- msg_id: EXACT msg_id from the [date|msg_id|conv:...] tag.",
    "",
    "DO NOT extract:",
    "- Felt obligations from others ('I should call my mum') — those demand action; that's the shoulds register.",
    "- Positive vows ('I always X' / 'I never Y' as a principle) — that's the vows register.",
    "- Factual incapability ('I can't speak Mandarin') — capability, not permission.",
    "- One-off aspirational frustration ('I can't seem to focus today') — not a self-restriction, a momentary state.",
    "- Same forbidden_action multiple times — pick the cleanest occurrence.",
    "",
    "British English. No em-dashes. Don't invent permission-slips. Quality over quantity. The signer is the most important field — if you can't sense WHO would have to grant permission, mark 'unknown' rather than guess. The real diagnostic value is in seeing that most of these slips have an external signer the user hasn't noticed.",
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

  let parsed: { permission_slips?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.permission_slips)) {
    return NextResponse.json({ error: "model output missing permission_slips array" }, { status: 502 });
  }

  type ParsedP = {
    forbidden_action?: unknown;
    signer?: unknown;
    authority_text?: unknown;
    domain?: unknown;
    charge?: unknown;
    recency?: unknown;
    confidence?: unknown;
    msg_id?: unknown;
  };

  type ValidP = {
    forbidden_action: string;
    signer: string;
    authority_text: string | null;
    domain: string;
    charge: number;
    recency: string;
    confidence: number;
    spoken_date: string;
    spoken_message_id: string;
    conversation_id: string | null;
  };

  const valid: ValidP[] = [];
  const seenLocal = new Set<string>();
  for (const p of parsed.permission_slips as ParsedP[]) {
    const action = typeof p.forbidden_action === "string" ? p.forbidden_action.trim().slice(0, 280) : "";
    const signer = typeof p.signer === "string" && VALID_SIGNERS.has(p.signer) ? p.signer : null;
    const authorityRaw = typeof p.authority_text === "string" ? p.authority_text.trim() : "";
    const authority = authorityRaw.length >= 4 ? authorityRaw.slice(0, 160) : null;
    const domain = typeof p.domain === "string" && VALID_DOMAINS.has(p.domain) ? p.domain : null;
    const charge = typeof p.charge === "number" ? Math.max(1, Math.min(5, Math.round(p.charge))) : 2;
    const recency = typeof p.recency === "string" && VALID_RECENCY.has(p.recency) ? p.recency : "older";
    const confidence = typeof p.confidence === "number" ? Math.max(1, Math.min(5, Math.round(p.confidence))) : 3;
    const msgId = typeof p.msg_id === "string" ? p.msg_id.trim() : "";

    if (!signer || !domain) continue;
    if (action.length < 4) continue;
    if (!msgId || !msgDates.has(msgId)) continue;
    if (confidence < 2) continue;

    const dedupKey = `${action.toLowerCase()}|${signer}`;
    if (seenLocal.has(dedupKey)) continue;
    seenLocal.add(dedupKey);

    valid.push({
      forbidden_action: action,
      signer,
      authority_text: authority,
      domain,
      charge,
      recency,
      confidence,
      spoken_date: msgDates.get(msgId) as string,
      spoken_message_id: msgId,
      conversation_id: msgConvos.get(msgId) ?? null,
    });
  }

  if (valid.length === 0) {
    return NextResponse.json({ ok: true, scan_id: "", inserted: 0, message: "no qualifying permission-slips detected", latency_ms: Date.now() - t0 });
  }

  const { data: existingRows } = await supabase
    .from("permission_slips")
    .select("id, forbidden_action, signer, status, pinned, resolution_note")
    .eq("user_id", user.id)
    .is("archived_at", null);

  type ExRow = {
    id: string;
    forbidden_action: string;
    signer: string;
    status: string;
    pinned: boolean;
    resolution_note: string | null;
  };
  const existingMap = new Map<string, ExRow>();
  for (const r of (existingRows ?? []) as ExRow[]) {
    existingMap.set(`${r.forbidden_action.toLowerCase()}|${r.signer}`, r);
  }

  const scanId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const latencyMs = Date.now() - t0;

  const toInsert: Array<Record<string, unknown>> = [];
  let dedupedCount = 0;
  for (const v of valid) {
    const key = `${v.forbidden_action.toLowerCase()}|${v.signer}`;
    if (existingMap.has(key)) { dedupedCount++; continue; }
    toInsert.push({
      user_id: user.id,
      scan_id: scanId,
      forbidden_action: v.forbidden_action,
      signer: v.signer,
      authority_text: v.authority_text,
      domain: v.domain,
      charge: v.charge,
      recency: v.recency,
      confidence: v.confidence,
      spoken_date: v.spoken_date,
      spoken_message_id: v.spoken_message_id,
      conversation_id: v.conversation_id,
      latency_ms: latencyMs,
      model,
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({
      ok: true,
      scan_id: scanId,
      inserted: 0,
      message: "all detected permission-slips already on file",
      latency_ms: latencyMs,
      signals: {
        candidate_messages: candidates.length,
        sampled: sampled.length,
        emitted: valid.length,
        deduped: dedupedCount,
      },
    });
  }

  const { data: inserted, error: insErr } = await supabase
    .from("permission_slips")
    .insert(toInsert)
    .select("id, scan_id, forbidden_action, signer, authority_text, domain, charge, recency, confidence, spoken_date, spoken_message_id, conversation_id, status, resolution_note, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at");
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: (inserted ?? []).length,
    permission_slips: inserted ?? [],
    latency_ms: latencyMs,
    signals: {
      candidate_messages: candidates.length,
      sampled: sampled.length,
      emitted: valid.length,
      deduped: dedupedCount,
    },
  });
}

export async function GET() {
  return NextResponse.json({ error: "POST only" }, { status: 405 });
}
