// POST /api/cabinet/scan — The Voice Cabinet (§167).
//
// Body: {} — no params. The cabinet aggregates over the existing §166
// shoulds table to surface the discrete VOICES that author the user's
// unmet obligations.
//
// One row per voice (max 7 in v1). The voice_type space mirrors the
// obligation_source space minus 'self' (the user's own voice is not a
// foreign authority).
//
// One Haiku call with the full candidate list → returns voice_name +
// voice_relation + typical_obligations distillation + influence_severity
// + confidence, per candidate.
//
// Upsert by (user_id, lower(voice_name)) so re-scans refresh existing
// rows rather than flooding the cabinet.

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 3500;

const FOREIGN_SOURCES = [
  "parent",
  "partner",
  "inner_critic",
  "social_norm",
  "professional_norm",
  "financial_judge",
  "abstract_other",
] as const;

type ForeignSource = (typeof FOREIGN_SOURCES)[number];

const VOICE_TYPE_FOR_SOURCE: Record<ForeignSource, string> = {
  parent: "parent",
  partner: "partner",
  inner_critic: "inner_critic",
  social_norm: "social_norm",
  professional_norm: "professional_norm",
  financial_judge: "financial_judge",
  abstract_other: "abstract_other",
};

const VALID_VOICE_TYPES = new Set([
  "parent",
  "partner",
  "inner_critic",
  "social_norm",
  "professional_norm",
  "financial_judge",
  "past_self",
  "future_self",
  "mentor",
  "abstract_other",
]);

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export async function POST() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const t0 = Date.now();

  type ShouldRow = {
    obligation_source: string;
    should_text: string;
    should_kind: string;
    distilled_obligation: string;
    domain: string;
    charge_score: number;
    spoken_date: string;
  };

  const { data: shouldRows, error: shouldErr } = await supabase
    .from("shoulds")
    .select("obligation_source, should_text, should_kind, distilled_obligation, domain, charge_score, spoken_date")
    .eq("user_id", user.id)
    .is("archived_at", null);
  if (shouldErr) return NextResponse.json({ error: shouldErr.message }, { status: 500 });

  const all = (shouldRows ?? []) as ShouldRow[];
  if (all.length < 5) {
    return NextResponse.json({
      error: "not enough shoulds on file to populate the cabinet — run a should ledger scan first (need at least 5 attributed shoulds)",
    }, { status: 400 });
  }

  type Bucket = {
    source: ForeignSource;
    rows: ShouldRow[];
    phrases: string[];
    kinds: Map<string, number>;
    domains: Map<string, number>;
    charge_total: number;
    first_date: string;
    last_date: string;
  };

  const buckets = new Map<ForeignSource, Bucket>();
  for (const src of FOREIGN_SOURCES) {
    buckets.set(src, {
      source: src,
      rows: [],
      phrases: [],
      kinds: new Map(),
      domains: new Map(),
      charge_total: 0,
      first_date: "9999-12-31",
      last_date: "0000-01-01",
    });
  }

  for (const r of all) {
    const src = r.obligation_source as ForeignSource;
    if (!FOREIGN_SOURCES.includes(src)) continue;
    const b = buckets.get(src);
    if (!b) continue;
    b.rows.push(r);
    if (b.phrases.length < 8) b.phrases.push(r.should_text.slice(0, 200));
    b.kinds.set(r.should_kind, (b.kinds.get(r.should_kind) ?? 0) + 1);
    b.domains.set(r.domain, (b.domains.get(r.domain) ?? 0) + 1);
    b.charge_total += r.charge_score;
    if (r.spoken_date < b.first_date) b.first_date = r.spoken_date;
    if (r.spoken_date > b.last_date) b.last_date = r.spoken_date;
  }

  type Candidate = {
    source: ForeignSource;
    voice_type: string;
    rows_count: number;
    phrases: string[];
    top_kinds: string[];
    top_domains: string[];
    charge_average: number;
    first_date: string;
    last_date: string;
    detection_span_days: number;
  };

  const candidates: Candidate[] = [];
  for (const b of buckets.values()) {
    if (b.rows.length < 2) continue;
    const topKinds = Array.from(b.kinds.entries())
      .sort((a, c) => c[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);
    const topDomains = Array.from(b.domains.entries())
      .sort((a, c) => c[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);
    const firstMs = new Date(b.first_date + "T12:00:00.000Z").getTime();
    const lastMs = new Date(b.last_date + "T12:00:00.000Z").getTime();
    const span = Math.max(1, Math.round((lastMs - firstMs) / 86_400_000) + 1);

    candidates.push({
      source: b.source,
      voice_type: VOICE_TYPE_FOR_SOURCE[b.source],
      rows_count: b.rows.length,
      phrases: b.phrases,
      top_kinds: topKinds,
      top_domains: topDomains,
      charge_average: Math.round((b.charge_total / b.rows.length) * 100) / 100,
      first_date: b.first_date,
      last_date: b.last_date,
      detection_span_days: span,
    });
  }

  if (candidates.length === 0) {
    return NextResponse.json({
      ok: true,
      scan_id: "",
      inserted: 0,
      message: "no foreign-voice attribution detected — your shoulds are mostly self-attributed (which is rare and worth noticing)",
      latency_ms: Date.now() - t0,
    });
  }

  const lines: string[] = [];
  lines.push(`SHOULDS ON FILE: ${all.length}`);
  lines.push(`VOICE CANDIDATES: ${candidates.length}`);
  lines.push("");
  for (const c of candidates) {
    lines.push(`--- VOICE CANDIDATE: source=${c.source} ---`);
    lines.push(`shoulds_attributed=${c.rows_count} | charge_avg=${c.charge_average} | span_days=${c.detection_span_days}`);
    lines.push(`top_kinds=${c.top_kinds.join(", ") || "(none)"} | top_domains=${c.top_domains.join(", ") || "(none)"}`);
    lines.push("typical_phrases (verbatim from user):");
    for (const p of c.phrases) lines.push(`  - "${p.replace(/\n+/g, " ")}"`);
    lines.push("");
  }

  const system = [
    "You are profiling the discrete VOICES that author a user's unmet obligations. The user's should-ledger has rows attributed to one of seven foreign sources: parent, partner, inner_critic, social_norm, professional_norm, financial_judge, abstract_other. Each candidate you receive is an aggregated source bucket: how many shoulds, what kinds, what domains, what verbatim phrases, what average charge. Your job: name the voice and distill its character.",
    "",
    "For each voice candidate, output:",
    "  voice_name           — short, evocative, 2-4 words. Examples: 'Mum's voice', 'The Inner Critic', 'Founder Voice', 'The Money Judge', 'Should-Be-A-Better-Partner Voice', 'Generic Society'. Avoid 'voice' on EVERY one (vary it). British English. No em-dashes.",
    "  voice_relation       — 6-12 words naming the relationship between this voice and the user. Examples: 'your mother, internalised', 'the self-critical part of you that sounds like a school report card', 'the founder/operator standard you hold yourself to', 'a generic voice of what people are supposed to do'.",
    "  typical_obligations  — 1-2 sentences distilling what THIS voice tends to demand. Speak ABOUT the voice, not as the voice. Examples: 'demands you stay in close touch with family and reach out more often than you do; surfaces around relational distance.' / 'demands sharper output, more shipping, less rest; surfaces around any week where you feel work is slipping.'",
    "  influence_severity   — 1-5. 1=mild background voice, 2=noticeable, 3=clearly shaping daily decisions, 4=heavy weight, 5=this voice is loud and chronic. Use the rows_count, charge_average, and span_days as the evidence. A voice with rows_count>=10 and charge_avg>=4 is a 5. A voice with rows_count<3 is at most 2.",
    "  confidence           — 1-5. 5=clear pattern with consistent verbatim evidence, 1=thin or ambiguous.",
    "",
    "Output strict JSON ONLY:",
    `{"voices": [{"source":"...", "voice_name":"...", "voice_relation":"...", "typical_obligations":"...", "influence_severity": 1-5, "confidence": 1-5}]}`,
    "",
    "Source-to-naming hints:",
    "  parent              — name it after the implied parent if obvious from phrases ('Mum's voice' / 'Dad's voice'); otherwise 'Parental voice'.",
    "  partner             — 'Partner's voice' or named partner if obvious.",
    "  inner_critic        — 'The Inner Critic' or a more specific name like 'The Failure-Predictor' if the phrases reveal a particular shape.",
    "  social_norm         — 'Generic Society' / 'The Done Thing' / 'The Adult-At-30 Voice'.",
    "  professional_norm   — 'Founder Voice' / 'Operator Standard' / 'Craft Standard' — pick from the phrases.",
    "  financial_judge     — 'The Money Judge' / 'The Frugal Voice' / 'The Pinching Voice'.",
    "  abstract_other      — 'Diffuse Should Voice' or similar. Mark confidence lower since the source itself is ambiguous.",
    "",
    "Rules:",
    "- Emit exactly ONE entry per source you received as a candidate. No skipping, no duplicates.",
    "- Don't extrapolate beyond what the phrases show. Speak about the OBSERVED demands, not the demands you imagine such a voice would make.",
    "- typical_obligations should NAME the recurring shape, not list every example.",
    "- Keep voice_name and voice_relation distinct (one names, one describes the relationship).",
    "- British English. No em-dashes.",
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

  let parsed: { voices?: unknown[] };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  if (!Array.isArray(parsed.voices)) {
    return NextResponse.json({ error: "model output missing voices array" }, { status: 502 });
  }

  type ParsedV = {
    source?: unknown;
    voice_name?: unknown;
    voice_relation?: unknown;
    typical_obligations?: unknown;
    influence_severity?: unknown;
    confidence?: unknown;
  };

  type Upsert = {
    user_id: string;
    scan_id: string;
    voice_name: string;
    voice_type: string;
    voice_relation: string;
    typical_phrases: string[];
    typical_obligations: string;
    typical_kinds: string[];
    typical_domains: string[];
    airtime_score: number;
    influence_severity: number;
    charge_average: number;
    shoulds_attributed: number;
    used_to_linked: number;
    inheritance_mentions: number;
    first_detected_at: string;
    last_detected_at: string;
    detection_span_days: number;
    confidence: number;
    latency_ms: number;
    model: string;
  };

  const scanId = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const latencyMs = Date.now() - t0;

  const candidatesBySource = new Map<ForeignSource, Candidate>();
  for (const c of candidates) candidatesBySource.set(c.source, c);

  const toUpsert: Upsert[] = [];
  const seenSources = new Set<ForeignSource>();

  for (const v of parsed.voices as ParsedV[]) {
    const source = typeof v.source === "string" && FOREIGN_SOURCES.includes(v.source as ForeignSource) ? (v.source as ForeignSource) : null;
    if (!source) continue;
    if (seenSources.has(source)) continue;
    const cand = candidatesBySource.get(source);
    if (!cand) continue;

    const name = typeof v.voice_name === "string" ? v.voice_name.trim().slice(0, 80) : "";
    if (name.length < 2) continue;
    const relation = typeof v.voice_relation === "string" ? v.voice_relation.trim().slice(0, 200) : "";
    const obligations = typeof v.typical_obligations === "string" ? v.typical_obligations.trim().slice(0, 600) : "";
    if (obligations.length < 10) continue;
    const severity = typeof v.influence_severity === "number" ? Math.max(1, Math.min(5, Math.round(v.influence_severity))) : 2;
    const confidence = typeof v.confidence === "number" ? Math.max(1, Math.min(5, Math.round(v.confidence))) : 3;

    seenSources.add(source);
    toUpsert.push({
      user_id: user.id,
      scan_id: scanId,
      voice_name: name,
      voice_type: VOICE_TYPE_FOR_SOURCE[source],
      voice_relation: relation,
      typical_phrases: cand.phrases,
      typical_obligations: obligations,
      typical_kinds: cand.top_kinds,
      typical_domains: cand.top_domains,
      airtime_score: cand.rows_count,
      influence_severity: severity,
      charge_average: cand.charge_average,
      shoulds_attributed: cand.rows_count,
      used_to_linked: 0,
      inheritance_mentions: 0,
      first_detected_at: cand.first_date,
      last_detected_at: cand.last_date,
      detection_span_days: cand.detection_span_days,
      confidence,
      latency_ms: latencyMs,
      model,
    });
  }

  if (toUpsert.length === 0) {
    return NextResponse.json({ ok: true, scan_id: scanId, inserted: 0, message: "no qualifying voices to surface", latency_ms: latencyMs });
  }

  type Existing = {
    id: string;
    voice_name: string;
    status: string;
    status_note: string | null;
    pinned: boolean;
    archived_at: string | null;
  };

  const lowerNames = toUpsert.map((u) => u.voice_name.toLowerCase());
  const { data: existingRows } = await supabase
    .from("voice_cabinet")
    .select("id, voice_name, status, status_note, pinned, archived_at")
    .eq("user_id", user.id);

  const existingByName = new Map<string, Existing>();
  for (const r of ((existingRows ?? []) as Existing[])) {
    if (lowerNames.includes(r.voice_name.toLowerCase())) {
      existingByName.set(r.voice_name.toLowerCase(), r);
    }
  }

  const inserts: Upsert[] = [];
  const updates: Array<{ id: string; patch: Partial<Upsert> & { updated_at: string } }> = [];
  const nowIso = new Date().toISOString();

  for (const u of toUpsert) {
    const ex = existingByName.get(u.voice_name.toLowerCase());
    if (ex) {
      updates.push({
        id: ex.id,
        patch: {
          scan_id: u.scan_id,
          voice_type: u.voice_type,
          voice_relation: u.voice_relation,
          typical_phrases: u.typical_phrases,
          typical_obligations: u.typical_obligations,
          typical_kinds: u.typical_kinds,
          typical_domains: u.typical_domains,
          airtime_score: u.airtime_score,
          influence_severity: u.influence_severity,
          charge_average: u.charge_average,
          shoulds_attributed: u.shoulds_attributed,
          first_detected_at: u.first_detected_at,
          last_detected_at: u.last_detected_at,
          detection_span_days: u.detection_span_days,
          confidence: u.confidence,
          latency_ms: u.latency_ms,
          model: u.model,
          updated_at: nowIso,
        },
      });
    } else {
      inserts.push(u);
    }
  }

  let insertedRows: unknown[] = [];
  if (inserts.length > 0) {
    const { data, error } = await supabase
      .from("voice_cabinet")
      .insert(inserts)
      .select("id, scan_id, voice_name, voice_type, voice_relation, typical_phrases, typical_obligations, typical_kinds, typical_domains, airtime_score, influence_severity, charge_average, shoulds_attributed, used_to_linked, inheritance_mentions, first_detected_at, last_detected_at, detection_span_days, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    insertedRows = data ?? [];
  }

  let updatedRows: unknown[] = [];
  for (const u of updates) {
    const { data, error } = await supabase
      .from("voice_cabinet")
      .update(u.patch)
      .eq("id", u.id)
      .eq("user_id", user.id)
      .select("id, scan_id, voice_name, voice_type, voice_relation, typical_phrases, typical_obligations, typical_kinds, typical_domains, airtime_score, influence_severity, charge_average, shoulds_attributed, used_to_linked, inheritance_mentions, first_detected_at, last_detected_at, detection_span_days, confidence, status, status_note, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (data) updatedRows.push(data);
  }

  return NextResponse.json({
    ok: true,
    scan_id: scanId,
    inserted: insertedRows.length,
    updated: updatedRows.length,
    voices: [...insertedRows, ...updatedRows],
    latency_ms: latencyMs,
    signals: {
      total_shoulds: all.length,
      voice_candidates: candidates.length,
      voice_types_emitted: VALID_VOICE_TYPES.size,
    },
  });
}

export async function GET() {
  return NextResponse.json({ error: "POST only" }, { status: 405 });
}
