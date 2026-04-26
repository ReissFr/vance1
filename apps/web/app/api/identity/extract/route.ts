// POST /api/identity/extract — runs Haiku across the user's recent
// reflections, decisions, themes, intentions, wins to extract
// identity claims (I am / I value / I refuse / I'm becoming / I aspire).
//
// Each claim has a normalized_key — a stopword-filtered lowercase
// signature — so that re-extraction merges with existing claims rather
// than duplicating: occurrences increments, last_seen_at updates,
// source_refs append. Claims a user stops voicing slowly drift to
// dormant (status update at end of run for any active claim whose
// last_seen_at is now older than 60 days).
//
// Body: { window_days?: 30|60|90|180|365 (default 90) }
// Returns: { extracted, merged, kept_active, marked_dormant, claims }

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 2000;

type SourceRef = { kind: string; id: string; snippet: string };
type Entry = { kind: string; id: string; date: string; text: string };

const VALID_KINDS = new Set(["am", "value", "refuse", "becoming", "aspire"]);

const STOPWORDS = new Set([
  "i","im","ive","me","my","mine","myself","you","your","yours","is","am","are","was","were","be","been",
  "being","a","an","the","of","to","in","on","for","with","at","by","from","as","into","onto","over",
  "and","or","but","not","no","so","than","then","just","also","very","really","always","never",
  "this","that","these","those","it","its","do","does","did","done","doing","will","would","could","should",
  "can","may","might","must","have","has","had","get","got","getting","like","more","less","much","many",
]);

function normalizeKey(s: string): string {
  const stripped = s.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
  const tokens = stripped.split(" ").filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return tokens.sort().join(" ").slice(0, 240);
}

function clampWindow(raw: unknown): number {
  const n = typeof raw === "number" ? raw : 90;
  if (n <= 30) return 30;
  if (n <= 60) return 60;
  if (n <= 90) return 90;
  if (n <= 180) return 180;
  return 365;
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

  const windowDays = clampWindow(body.window_days);
  const sinceIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const sinceDate = sinceIso.slice(0, 10);

  const [reflRes, decRes, themesRes, intRes, winsRes] = await Promise.all([
    supabase.from("reflections").select("id, text, kind, created_at").eq("user_id", user.id).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(120),
    supabase.from("decisions").select("id, title, choice, context, expected_outcome, created_at").eq("user_id", user.id).gte("created_at", sinceIso).limit(60),
    supabase.from("themes").select("id, title, description, current_state, kind, status, updated_at").eq("user_id", user.id).limit(40),
    supabase.from("intentions").select("id, log_date, text").eq("user_id", user.id).gte("log_date", sinceDate).order("log_date", { ascending: false }).limit(120),
    supabase.from("wins").select("id, text, kind, created_at").eq("user_id", user.id).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(60),
  ]);

  const entries: Entry[] = [];
  for (const r of (reflRes.data ?? []) as Array<{ id: string; text: string; kind: string | null; created_at: string }>) {
    entries.push({ kind: "reflection", id: r.id, date: r.created_at.slice(0, 10), text: `[${r.kind ?? "reflection"}] ${r.text}` });
  }
  for (const r of (decRes.data ?? []) as Array<{ id: string; title: string; choice: string | null; context: string | null; expected_outcome: string | null; created_at: string }>) {
    const t = [r.title, r.choice && `chose: ${r.choice}`, r.context && `context: ${r.context}`, r.expected_outcome && `expected: ${r.expected_outcome}`].filter(Boolean).join(" — ");
    entries.push({ kind: "decision", id: r.id, date: r.created_at.slice(0, 10), text: t });
  }
  for (const r of (themesRes.data ?? []) as Array<{ id: string; title: string; description: string | null; current_state: string | null; kind: string; status: string; updated_at: string }>) {
    const t = [r.title, r.description, r.current_state].filter(Boolean).join(" — ");
    entries.push({ kind: "theme", id: r.id, date: r.updated_at.slice(0, 10), text: `[${r.kind}/${r.status}] ${t}` });
  }
  for (const r of (intRes.data ?? []) as Array<{ id: string; log_date: string; text: string }>) {
    entries.push({ kind: "intention", id: r.id, date: r.log_date, text: r.text });
  }
  for (const r of (winsRes.data ?? []) as Array<{ id: string; text: string; kind: string | null; created_at: string }>) {
    entries.push({ kind: "win", id: r.id, date: r.created_at.slice(0, 10), text: `[${r.kind ?? "win"}] ${r.text}` });
  }

  if (entries.length < 5) {
    return NextResponse.json({ error: "not enough recent entries to extract identity claims" }, { status: 400 });
  }

  const dump = entries
    .slice(0, 250)
    .map((e) => `${e.kind}#${e.id} (${e.date}): ${e.text.replace(/\s+/g, " ").slice(0, 240)}`)
    .join("\n");

  const system = [
    "You are extracting IDENTITY CLAIMS from the user's own writing — explicit and revealed self-statements about who they are, what they value, what they refuse, who they are becoming, who they aspire to be.",
    "",
    "Output strict JSON: { \"claims\": [...] }. No prose outside the JSON.",
    "",
    "Each claim has fields:",
    "- kind: one of am | value | refuse | becoming | aspire",
    "- statement: a clean, second-person identity statement (e.g. 'You are a builder', 'You value depth over breadth', 'You refuse meetings before 11', 'You are becoming someone who ships', 'You aspire to write daily'). Keep it short, declarative, present tense. British English. No em-dashes.",
    "- source_refs: 1-3 entries from the dump that ground this claim, as {kind, id, snippet}. snippet ≤ 80 chars. NEVER invent IDs.",
    "",
    "Kind taxonomy:",
    "- am: trait or identity (already true). 'You are X.'",
    "- value: principle the user weights when deciding. 'You value X.' or 'You value X over Y.'",
    "- refuse: hard line, no-go, drawn boundary. 'You refuse X.' or 'You don't do X.'",
    "- becoming: in-flight identity shift; user is mid-transition. 'You are becoming X.' (Use only when there's evidence of change-in-progress, not steady state.)",
    "- aspire: explicit forward-looking want. 'You aspire to be X.' (Use only when the user has explicitly named the want.)",
    "",
    "Rules:",
    "- Each claim MUST be grounded in at least one source_ref. NEVER make up patterns from a single throwaway entry — require either repetition or strong explicit declaration.",
    "- Quality over quota. 5-12 claims is healthy. If only 3 are honestly there, return 3.",
    "- Do NOT moralise. Do NOT recommend. Surface, don't prescribe.",
    "- Phrase 'value' / 'refuse' as what the user actually voices, not what you think they should value.",
    "- If a claim has been contradicted in the dump (user voiced X then voiced ¬X), prefer the more recent/repeated voicing.",
    "- Avoid generic platitudes ('you value progress'). Prefer specific, idiosyncratic claims with bite.",
  ].join("\n");

  const userMsg = `JOURNAL DUMP (last ${windowDays} days, ${entries.length} entries):\n\n${dump}`;

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

  let parsed: { claims?: unknown };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  const seenIds = new Set<string>(entries.map((e) => `${e.kind}#${e.id}`));
  const validated: Array<{ kind: string; statement: string; source_refs: SourceRef[] }> = [];
  if (Array.isArray(parsed.claims)) {
    for (const item of parsed.claims) {
      if (typeof item !== "object" || !item) continue;
      const c = item as Record<string, unknown>;
      const kind = String(c.kind ?? "");
      if (!VALID_KINDS.has(kind)) continue;
      const statement = typeof c.statement === "string" ? c.statement.trim() : "";
      if (statement.length < 6 || statement.length > 200) continue;
      const refsRaw = Array.isArray(c.source_refs) ? c.source_refs : [];
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
      validated.push({ kind, statement, source_refs: refs });
    }
  }

  if (validated.length === 0) {
    return NextResponse.json({ extracted: 0, merged: 0, kept_active: 0, marked_dormant: 0, claims: [], note: "no grounded claims" });
  }

  // Upsert by normalized_key.
  const now = new Date().toISOString();
  const { data: existingRows } = await supabase
    .from("identity_claims")
    .select("id, kind, statement, normalized_key, occurrences, source_refs, status")
    .eq("user_id", user.id);

  const existingByKey = new Map<string, { id: string; kind: string; statement: string; normalized_key: string; occurrences: number; source_refs: SourceRef[]; status: string }>();
  for (const r of (existingRows ?? []) as Array<{ id: string; kind: string; statement: string; normalized_key: string; occurrences: number; source_refs: SourceRef[]; status: string }>) {
    existingByKey.set(r.normalized_key, r);
  }

  let extractedCount = 0;
  let mergedCount = 0;
  for (const v of validated) {
    const key = normalizeKey(v.statement);
    if (key.length < 4) continue;
    const existing = existingByKey.get(key);
    if (existing) {
      // Merge: bump occurrences, update last_seen_at, append refs (dedup).
      const seenRefIds = new Set((existing.source_refs ?? []).map((r) => `${r.kind}#${r.id}`));
      const newRefs = [...(existing.source_refs ?? [])];
      for (const r of v.source_refs) {
        if (!seenRefIds.has(`${r.kind}#${r.id}`)) {
          newRefs.push(r);
          seenRefIds.add(`${r.kind}#${r.id}`);
        }
      }
      const cappedRefs = newRefs.slice(-12);
      await supabase
        .from("identity_claims")
        .update({
          occurrences: existing.occurrences + 1,
          last_seen_at: now,
          source_refs: cappedRefs,
          status: existing.status === "retired" ? "retired" : "active",
          updated_at: now,
        })
        .eq("id", existing.id)
        .eq("user_id", user.id);
      mergedCount++;
    } else {
      await supabase
        .from("identity_claims")
        .insert({
          user_id: user.id,
          kind: v.kind,
          statement: v.statement.slice(0, 240),
          normalized_key: key,
          occurrences: 1,
          first_seen_at: now,
          last_seen_at: now,
          source_refs: v.source_refs,
          status: "active",
        });
      extractedCount++;
    }
  }

  // Mark stale active claims as dormant (last_seen_at > 60 days ago).
  const dormantCutoff = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data: dormantUpdated } = await supabase
    .from("identity_claims")
    .update({ status: "dormant", updated_at: now })
    .eq("user_id", user.id)
    .eq("status", "active")
    .lt("last_seen_at", dormantCutoff)
    .select("id");

  const { data: finalClaims } = await supabase
    .from("identity_claims")
    .select("id, kind, statement, normalized_key, occurrences, first_seen_at, last_seen_at, source_refs, status, contradiction_note, user_note, pinned")
    .eq("user_id", user.id)
    .order("pinned", { ascending: false })
    .order("occurrences", { ascending: false });

  return NextResponse.json({
    extracted: extractedCount,
    merged: mergedCount,
    kept_active: validated.length,
    marked_dormant: (dormantUpdated ?? []).length,
    claims: finalClaims ?? [],
  });
}
