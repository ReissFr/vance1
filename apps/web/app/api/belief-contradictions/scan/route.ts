// POST /api/belief-contradictions/scan — scans the user's active
// identity claims (especially `value` + `refuse`) against recent
// behaviour (decisions / standups / wins / reflections / intentions /
// daily check-ins) and writes back structured contradiction pairs.
//
// Each pair joins exactly one identity_claim with exactly one evidence
// row from the supported source set. The Haiku model writes a short
// note explaining the conflict and assigns severity (1=mild drift,
// 5=outright contradiction). Server-side filters drop pairs where the
// claim_id or evidence_id isn't in the dump (no fabrication), and skip
// pairs where there's already an OPEN row for the same (claim_id,
// evidence_kind, evidence_id) — so re-scanning doesn't duplicate.
//
// Body: { window_days?: 14|30|60|90 (default 60), max?: number (default 8) }
// Returns: { generated: BeliefContradiction[], skipped_existing: number }

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 1800;

const VALID_CLAIM_KINDS = new Set(["am", "value", "refuse", "becoming", "aspire"]);
const VALID_EVIDENCE_KINDS = new Set([
  "decision",
  "standup",
  "win",
  "reflection",
  "intention",
  "checkin",
]);

type ClaimRow = {
  id: string;
  kind: string;
  statement: string;
  status: string;
  occurrences: number;
  last_seen_at: string;
};

type EvidenceEntry = {
  kind: string;
  id: string;
  date: string;
  text: string;
};

type ProposedPair = {
  claim_id: string;
  evidence_kind: string;
  evidence_id: string;
  severity: number;
  note: string;
};

function clampWindow(raw: unknown): number {
  const n = typeof raw === "number" ? raw : 60;
  if (n <= 14) return 14;
  if (n <= 30) return 30;
  if (n <= 90) return n <= 60 ? 60 : 90;
  return 60;
}

function clampMax(raw: unknown): number {
  const n = typeof raw === "number" ? raw : 8;
  return Math.max(1, Math.min(20, Math.round(n)));
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

  let body: { window_days?: number; max?: number } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const windowDays = clampWindow(body.window_days);
  const maxPairs = clampMax(body.max);

  const since = new Date(Date.now() - windowDays * 86_400_000);
  const sinceIso = since.toISOString();
  const sinceDate = sinceIso.slice(0, 10);

  // Pull active identity claims, prioritising value + refuse since those
  // are the kinds where contradiction is most meaningful.
  const { data: claimsRaw, error: claimsErr } = await supabase
    .from("identity_claims")
    .select("id, kind, statement, status, occurrences, last_seen_at")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("kind", { ascending: false })
    .order("occurrences", { ascending: false })
    .limit(60);
  if (claimsErr) return NextResponse.json({ error: claimsErr.message }, { status: 500 });

  const claims = ((claimsRaw ?? []) as ClaimRow[]).filter((c) => VALID_CLAIM_KINDS.has(c.kind));
  if (claims.length < 2) {
    return NextResponse.json({ generated: [], note: "not enough active identity claims to scan — extract identity first" });
  }

  // Pull evidence rows in parallel.
  const [decRes, stdRes, winRes, reflRes, intRes, chkRes] = await Promise.all([
    supabase.from("decisions").select("id, title, choice, expected_outcome, context, created_at").eq("user_id", user.id).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(40),
    supabase.from("standups").select("id, log_date, yesterday, today, blockers").eq("user_id", user.id).gte("log_date", sinceDate).order("log_date", { ascending: false }).limit(40),
    supabase.from("wins").select("id, text, kind, created_at").eq("user_id", user.id).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(40),
    supabase.from("reflections").select("id, text, kind, created_at").eq("user_id", user.id).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(60),
    supabase.from("intentions").select("id, log_date, text, completed_at").eq("user_id", user.id).gte("log_date", sinceDate).order("log_date", { ascending: false }).limit(60),
    supabase.from("daily_checkins").select("id, log_date, energy, mood, focus, note").eq("user_id", user.id).gte("log_date", sinceDate).order("log_date", { ascending: false }).limit(40),
  ]);

  const evidence: EvidenceEntry[] = [];
  for (const r of (decRes.data ?? []) as Array<{ id: string; title: string; choice: string | null; expected_outcome: string | null; context: string | null; created_at: string }>) {
    const parts = [r.title, r.choice && `chose: ${r.choice}`, r.context && `context: ${r.context.slice(0, 200)}`].filter(Boolean).join(" — ");
    evidence.push({ kind: "decision", id: r.id, date: r.created_at.slice(0, 10), text: parts });
  }
  for (const r of (stdRes.data ?? []) as Array<{ id: string; log_date: string; yesterday: string | null; today: string | null; blockers: string | null }>) {
    const t = [r.yesterday && `yesterday: ${r.yesterday}`, r.today && `today: ${r.today}`, r.blockers && `blockers: ${r.blockers}`].filter(Boolean).join(" | ");
    if (t) evidence.push({ kind: "standup", id: r.id, date: r.log_date, text: t });
  }
  for (const r of (winRes.data ?? []) as Array<{ id: string; text: string; kind: string | null; created_at: string }>) {
    evidence.push({ kind: "win", id: r.id, date: r.created_at.slice(0, 10), text: `[${r.kind ?? "win"}] ${r.text}` });
  }
  for (const r of (reflRes.data ?? []) as Array<{ id: string; text: string; kind: string | null; created_at: string }>) {
    evidence.push({ kind: "reflection", id: r.id, date: r.created_at.slice(0, 10), text: `[${r.kind ?? "reflection"}] ${r.text}` });
  }
  for (const r of (intRes.data ?? []) as Array<{ id: string; log_date: string; text: string; completed_at: string | null }>) {
    evidence.push({ kind: "intention", id: r.id, date: r.log_date, text: `${r.text}${r.completed_at ? " · ✓ done" : " · open"}` });
  }
  for (const r of (chkRes.data ?? []) as Array<{ id: string; log_date: string; energy: number | null; mood: number | null; focus: number | null; note: string | null }>) {
    if (!r.note || r.note.trim().length < 4) continue;
    evidence.push({
      kind: "checkin",
      id: r.id,
      date: r.log_date,
      text: `e${r.energy ?? "?"}/m${r.mood ?? "?"}/f${r.focus ?? "?"} — ${r.note}`,
    });
  }

  if (evidence.length < 4) {
    return NextResponse.json({ generated: [], note: "not enough recent behaviour to scan — write a few standups / reflections first" });
  }

  const claimDump = claims
    .map((c) => `claim#${c.id} [${c.kind}]: ${c.statement.slice(0, 180)}`)
    .join("\n");
  const evDump = evidence
    .slice(0, 200)
    .map((e) => `${e.kind}#${e.id} (${e.date}): ${e.text.replace(/\s+/g, " ").slice(0, 240)}`)
    .join("\n");

  const system = [
    "You are scanning the user's stated beliefs against their recent behaviour and surfacing concrete contradiction pairs the user can look at.",
    "",
    `Output strict JSON: { "pairs": [...] } with up to ${maxPairs} entries. No prose outside the JSON.`,
    "",
    "Each pair has fields:",
    "- claim_id: must be one of the claim ids in the IDENTITY DUMP below (e.g. 'claim#abc-123' — return JUST the uuid part after 'claim#')",
    "- evidence_kind: one of decision | standup | win | reflection | intention | checkin",
    "- evidence_id: the uuid of the evidence row from the EVIDENCE DUMP (e.g. for 'decision#abc' return JUST 'abc')",
    "- severity: 1-5 (1 = mild drift, 5 = outright contradiction)",
    "- note: 1-2 sentences naming SPECIFICALLY what clashes — quote a phrase from each side if helpful. Second person ('you …'). British English. No em-dashes. No moralising.",
    "",
    "What counts as a contradiction:",
    "- A `value` claim ('you value deep work') paired with a standup full of meetings",
    "- A `refuse` claim ('you refuse to take meetings before 11') paired with a calendar decision that breaks it",
    "- A `becoming` claim ('you are becoming someone who ships daily') paired with a string of zero-win days",
    "- A stated identity ('you are a long-form thinker') paired with reflections about chasing dopamine",
    "Look for clashes especially against `value` and `refuse` claims — those are sharpest. Don't force `am`/`becoming`/`aspire` pairs unless the clash is real.",
    "",
    "Rules:",
    "- Each pair MUST cite exactly one claim_id from the dump and exactly one evidence_id from the dump. Never invent ids.",
    "- One claim can appear in multiple pairs (different evidence rows can each contradict it). Try to vary across claims and severities.",
    "- If a piece of evidence is mentioned in a 'changed-mind' or 'lesson learned' reflection, that's NOT a contradiction — it's growth. Skip it.",
    "- If you can only honestly find 2 pairs, output 2. Quality over quota.",
    "- If nothing is clearly worth surfacing, return { \"pairs\": [] }.",
  ].join("\n");

  const userMsg = `IDENTITY DUMP (active claims, ${claims.length}):\n${claimDump}\n\nEVIDENCE DUMP (last ${windowDays} days, ${evidence.length} rows):\n${evDump}`;

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

  let parsed: { pairs?: unknown };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  const claimsById = new Map<string, ClaimRow>(claims.map((c) => [c.id, c]));
  const evidenceById = new Map<string, EvidenceEntry>(evidence.map((e) => [`${e.kind}#${e.id}`, e]));

  const proposed: ProposedPair[] = [];
  if (Array.isArray(parsed.pairs)) {
    for (const item of parsed.pairs) {
      if (typeof item !== "object" || !item) continue;
      const p = item as Record<string, unknown>;
      const claimId = typeof p.claim_id === "string" ? p.claim_id.replace(/^claim#/, "").trim() : "";
      const evKind = typeof p.evidence_kind === "string" ? p.evidence_kind.trim() : "";
      const evId = typeof p.evidence_id === "string" ? p.evidence_id.trim() : "";
      if (!claimId || !evKind || !evId) continue;
      if (!VALID_EVIDENCE_KINDS.has(evKind)) continue;
      if (!claimsById.has(claimId)) continue;
      if (!evidenceById.has(`${evKind}#${evId}`)) continue;
      const sev = typeof p.severity === "number" ? Math.max(1, Math.min(5, Math.round(p.severity))) : 3;
      const note = typeof p.note === "string" ? p.note.trim() : "";
      if (note.length < 8) continue;
      proposed.push({
        claim_id: claimId,
        evidence_kind: evKind,
        evidence_id: evId,
        severity: sev,
        note: note.slice(0, 600),
      });
      if (proposed.length >= maxPairs) break;
    }
  }

  if (proposed.length === 0) {
    return NextResponse.json({ generated: [], note: "model returned no grounded pairs" });
  }

  // Skip pairs that already have an OPEN row.
  const claimIds = Array.from(new Set(proposed.map((p) => p.claim_id)));
  const { data: existingOpen } = await supabase
    .from("belief_contradictions")
    .select("claim_id, evidence_kind, evidence_id")
    .eq("user_id", user.id)
    .eq("status", "open")
    .in("claim_id", claimIds);
  const existingKey = new Set<string>(
    (existingOpen ?? []).map(
      (r: { claim_id: string; evidence_kind: string; evidence_id: string }) =>
        `${r.claim_id}|${r.evidence_kind}|${r.evidence_id}`,
    ),
  );

  const fresh = proposed.filter(
    (p) => !existingKey.has(`${p.claim_id}|${p.evidence_kind}|${p.evidence_id}`),
  );
  if (fresh.length === 0) {
    return NextResponse.json({
      generated: [],
      skipped_existing: proposed.length,
      note: "all detected pairs already exist as open contradictions",
    });
  }

  const inserts = fresh.map((p) => {
    const claim = claimsById.get(p.claim_id)!;
    const ev = evidenceById.get(`${p.evidence_kind}#${p.evidence_id}`)!;
    return {
      user_id: user.id,
      claim_id: p.claim_id,
      claim_kind: claim.kind,
      claim_text: claim.statement.slice(0, 500),
      evidence_kind: p.evidence_kind,
      evidence_id: p.evidence_id,
      evidence_text: ev.text.slice(0, 600),
      evidence_date: ev.date,
      severity: p.severity,
      note: p.note,
      scan_window_days: windowDays,
    };
  });

  const { data: inserted, error } = await supabase
    .from("belief_contradictions")
    .insert(inserts)
    .select(
      "id, claim_id, claim_kind, claim_text, evidence_kind, evidence_id, evidence_text, evidence_date, severity, note, status, scan_window_days, created_at",
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    generated: inserted ?? [],
    skipped_existing: proposed.length - fresh.length,
  });
}
