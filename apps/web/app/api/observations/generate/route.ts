// POST /api/observations/generate — runs a Haiku scan over the last N days
// of the user's journal entries and writes back observations: patterns,
// contradictions, blind spots, growth signals, encouragements, questions.
//
// This is the brain's "inner monologue" — it reads across wins, reflections,
// decisions, predictions, intentions, standups, themes, policies and
// surfaces things it has noticed about the user that the user hasn't said
// out loud. Each observation cites source IDs from the dump so the UI can
// link back — observations must be auditable, not vibes.
//
// Body: { window_days?: 7|14|30|60 (default 30), max?: number (default 6) }
// Returns: { generated: Observation[] }

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 1500;

type SourceRef = { kind: string; id: string; snippet: string };

type Observation = {
  kind: "pattern" | "contradiction" | "blind_spot" | "growth" | "encouragement" | "question";
  body: string;
  confidence: number;
  source_refs: SourceRef[];
};

type Entry = { kind: string; id: string; date: string; text: string };

const VALID_KINDS = new Set([
  "pattern",
  "contradiction",
  "blind_spot",
  "growth",
  "encouragement",
  "question",
]);

function clampDays(raw: unknown): number {
  const n = typeof raw === "number" ? raw : 30;
  if (n <= 7) return 7;
  if (n <= 14) return 14;
  if (n <= 60) return n <= 30 ? 30 : 60;
  return 30;
}

function clampMax(raw: unknown): number {
  const n = typeof raw === "number" ? raw : 6;
  return Math.max(1, Math.min(12, Math.round(n)));
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
  try { body = await req.json(); } catch { /* allow empty body */ }

  const windowDays = clampDays(body.window_days);
  const maxObs = clampMax(body.max);

  const since = new Date(Date.now() - windowDays * 86_400_000);
  const sinceIso = since.toISOString();
  const sinceDate = sinceIso.slice(0, 10);

  const [winsRes, reflRes, decRes, predRes, intRes, stdRes, themesRes, policiesRes] = await Promise.all([
    supabase.from("wins").select("id, text, kind, created_at").eq("user_id", user.id).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(80),
    supabase.from("reflections").select("id, text, kind, tags, created_at").eq("user_id", user.id).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(80),
    supabase.from("decisions").select("id, title, choice, expected_outcome, context, created_at").eq("user_id", user.id).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(40),
    supabase.from("predictions").select("id, claim, confidence, status, resolve_by, resolved_note").eq("user_id", user.id).gte("created_at", sinceIso).limit(40),
    supabase.from("intentions").select("id, log_date, text, completed_at").eq("user_id", user.id).gte("log_date", sinceDate).order("log_date", { ascending: false }).limit(80),
    supabase.from("standups").select("id, log_date, yesterday, today, blockers").eq("user_id", user.id).gte("log_date", sinceDate).order("log_date", { ascending: false }).limit(40),
    supabase.from("themes").select("id, title, current_state, kind, status, updated_at").eq("user_id", user.id).eq("status", "active").limit(20),
    supabase.from("policies").select("id, name, rule, category, priority, active").eq("user_id", user.id).eq("active", true).limit(40),
  ]);

  const entries: Entry[] = [];
  for (const r of (winsRes.data ?? []) as Array<{ id: string; text: string; kind: string | null; created_at: string }>) {
    entries.push({ kind: "win", id: r.id, date: r.created_at.slice(0, 10), text: `[${r.kind ?? "win"}] ${r.text}` });
  }
  for (const r of (reflRes.data ?? []) as Array<{ id: string; text: string; kind: string | null; tags: string[] | null; created_at: string }>) {
    entries.push({ kind: "reflection", id: r.id, date: r.created_at.slice(0, 10), text: `[${r.kind ?? "reflection"}] ${r.text}` });
  }
  for (const r of (decRes.data ?? []) as Array<{ id: string; title: string; choice: string | null; expected_outcome: string | null; context: string | null; created_at: string }>) {
    const parts = [r.title, r.choice && `chose: ${r.choice}`, r.expected_outcome && `expected: ${r.expected_outcome}`].filter(Boolean).join(" — ");
    entries.push({ kind: "decision", id: r.id, date: r.created_at.slice(0, 10), text: parts });
  }
  for (const r of (predRes.data ?? []) as Array<{ id: string; claim: string; confidence: number; status: string; resolve_by: string; resolved_note: string | null }>) {
    entries.push({ kind: "prediction", id: r.id, date: r.resolve_by, text: `${r.claim} · ${r.confidence}% · ${r.status}${r.resolved_note ? ` · ${r.resolved_note}` : ""}` });
  }
  for (const r of (intRes.data ?? []) as Array<{ id: string; log_date: string; text: string; completed_at: string | null }>) {
    entries.push({ kind: "intention", id: r.id, date: r.log_date, text: `${r.text}${r.completed_at ? " · ✓" : " · open"}` });
  }
  for (const r of (stdRes.data ?? []) as Array<{ id: string; log_date: string; yesterday: string | null; today: string | null; blockers: string | null }>) {
    const t = [r.yesterday && `yesterday: ${r.yesterday}`, r.today && `today: ${r.today}`, r.blockers && `blockers: ${r.blockers}`].filter(Boolean).join(" | ");
    if (t) entries.push({ kind: "standup", id: r.id, date: r.log_date, text: t });
  }
  for (const r of (themesRes.data ?? []) as Array<{ id: string; title: string; current_state: string | null; kind: string; updated_at: string }>) {
    entries.push({ kind: "theme", id: r.id, date: r.updated_at.slice(0, 10), text: `[${r.kind}] ${r.title}${r.current_state ? ` · ${r.current_state}` : ""}` });
  }
  for (const r of (policiesRes.data ?? []) as Array<{ id: string; name: string; rule: string; category: string; priority: number }>) {
    entries.push({ kind: "policy", id: r.id, date: sinceDate, text: `[${r.category}/p${r.priority}] ${r.name}: ${r.rule}` });
  }

  if (entries.length < 4) {
    return NextResponse.json({ generated: [], note: "not enough recent journal entries to scan" });
  }

  const dataDump = entries
    .slice(0, 200)
    .map((e) => `${e.kind}#${e.id} (${e.date}): ${e.text.replace(/\s+/g, " ").slice(0, 240)}`)
    .join("\n");

  const system = [
    "You are the user's inner monologue — the brain talking to itself about the user, in the background.",
    "You read across the user's recent journal entries (wins, reflections, decisions, predictions, intentions, standups, active themes, policies) and surface things you have NOTICED that the user has not said out loud.",
    "",
    `Output strict JSON: { "observations": [...] } with up to ${maxObs} entries. No prose outside the JSON.`,
    "",
    "Each observation has fields:",
    "- kind: one of pattern | contradiction | blind_spot | growth | encouragement | question",
    "- body: 1-2 sentences, second person ('you …'), warm but honest, no hedging filler. British English. No em-dashes.",
    "- confidence: 1-5 (5 = strongly grounded across multiple entries)",
    "- source_refs: array of {kind, id, snippet} pointing to the exact entries from the dump that ground the observation. snippet ≤ 80 chars. NEVER invent ids.",
    "",
    "Kinds — pick the right one:",
    "- pattern: a recurring theme the user keeps returning to",
    "- contradiction: something said in one entry clashes with another (a stated value vs an actual choice; an intention vs a behaviour)",
    "- blind_spot: a topic the user is conspicuously avoiding or under-weighting",
    "- growth: visible improvement, momentum, or shift over time — be specific about what changed",
    "- encouragement: an affirming observation grounded in real entries (not generic praise)",
    "- question: an unanswered question worth sitting with — phrase it as a real question",
    "",
    "Rules:",
    "- Each observation MUST cite at least 1 source_ref, ideally 2-3 across different entries.",
    "- Do NOT make up patterns from a single entry. Do NOT moralise. Do NOT recommend actions — surface, do not prescribe.",
    "- If you can only honestly find 2 observations, output 2. Quality over quota.",
    "- If nothing is clearly worth surfacing, return { \"observations\": [] }.",
  ].join("\n");

  const userMsg = `JOURNAL DUMP (last ${windowDays} days, ${entries.length} entries):\n\n${dataDump}`;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  const anthropic = new Anthropic({ apiKey });

  let raw = "";
  let model = MODEL;
  let modelSwitched = false;
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
      if (!modelSwitched && isOverloaded(e)) { modelSwitched = true; model = FALLBACK_MODEL; continue; }
      return NextResponse.json({ error: e instanceof Error ? e.message : "haiku failed" }, { status: 502 });
    }
  }

  let parsed: { observations?: unknown };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  const seenIds = new Set<string>(entries.map((e) => `${e.kind}#${e.id}`));
  const out: Observation[] = [];
  if (Array.isArray(parsed.observations)) {
    for (const item of parsed.observations) {
      if (typeof item !== "object" || !item) continue;
      const obs = item as Record<string, unknown>;
      const kind = String(obs.kind ?? "");
      if (!VALID_KINDS.has(kind)) continue;
      const bodyText = typeof obs.body === "string" ? obs.body.trim() : "";
      if (bodyText.length < 8) continue;
      const conf = typeof obs.confidence === "number" ? Math.max(1, Math.min(5, Math.round(obs.confidence))) : 3;
      const refsRaw = Array.isArray(obs.source_refs) ? obs.source_refs : [];
      const refs: SourceRef[] = [];
      for (const r of refsRaw) {
        if (typeof r !== "object" || !r) continue;
        const rec = r as Record<string, unknown>;
        const rk = typeof rec.kind === "string" ? rec.kind : "";
        const rid = typeof rec.id === "string" ? rec.id : "";
        if (!rk || !rid) continue;
        if (!seenIds.has(`${rk}#${rid}`)) continue;
        refs.push({ kind: rk, id: rid, snippet: typeof rec.snippet === "string" ? rec.snippet.slice(0, 80) : "" });
      }
      if (refs.length === 0) continue;
      out.push({ kind: kind as Observation["kind"], body: bodyText.slice(0, 600), confidence: conf, source_refs: refs });
      if (out.length >= maxObs) break;
    }
  }

  if (out.length === 0) {
    return NextResponse.json({ generated: [], note: "model returned no grounded observations" });
  }

  const inserts = out.map((o) => ({
    user_id: user.id,
    kind: o.kind,
    body: o.body,
    confidence: o.confidence,
    source_refs: o.source_refs,
    window_days: windowDays,
  }));

  const { data: inserted, error } = await supabase
    .from("observations")
    .insert(inserts)
    .select("id, kind, body, confidence, source_refs, window_days, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ generated: inserted ?? [] });
}
