// POST /api/decisions/[id]/premortem — generate 3-5 plausible failure
// modes for a decision via Haiku. Inserts them into decision_premortems
// with status='watching'. Returns the inserted rows.
//
// Body (optional): { count?: 3-5, replace?: boolean }
// If replace=true, deletes existing premortems for the decision before
// inserting fresh ones. Default: appends.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 1000;

type FailureMode = {
  failure_mode: string;
  likelihood: number;
  mitigation: string;
};

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: decisionId } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { count?: number; replace?: boolean } = {};
  try { body = await req.json(); } catch { /* allow empty body */ }
  const count = Math.max(3, Math.min(5, Math.round(body.count ?? 4)));
  const replace = body.replace === true;

  const { data: decision, error: decErr } = await supabase
    .from("decisions")
    .select("id, title, choice, context, expected_outcome, alternatives")
    .eq("user_id", user.id)
    .eq("id", decisionId)
    .single();
  if (decErr || !decision) return NextResponse.json({ error: "decision not found" }, { status: 404 });

  const dec = decision as { id: string; title: string; choice: string | null; context: string | null; expected_outcome: string | null; alternatives: string | null };

  if (replace) {
    await supabase.from("decision_premortems").delete().eq("user_id", user.id).eq("decision_id", decisionId);
  }

  const dump = [
    `DECISION: ${dec.title}`,
    dec.choice ? `CHOICE: ${dec.choice}` : null,
    dec.context ? `CONTEXT: ${dec.context}` : null,
    dec.expected_outcome ? `EXPECTED: ${dec.expected_outcome}` : null,
    dec.alternatives ? `ALTERNATIVES CONSIDERED: ${dec.alternatives}` : null,
  ].filter(Boolean).join("\n");

  const system = [
    "You are running a pre-mortem on a decision the user has already made. Imagine the decision has FAILED 6-12 months from now and surface the most plausible causes.",
    "",
    `Output strict JSON: { "failure_modes": [...] } with exactly ${count} entries. No prose outside the JSON.`,
    "",
    "Each failure mode has:",
    "- failure_mode: 1 sentence, second person ('you …'), concrete and specific (not 'things go wrong'). British English.",
    "- likelihood: 1-5 (5 = most likely)",
    "- mitigation: 1 short sentence — a concrete action the user could take to reduce or detect this failure early. If genuinely unknowable, say 'no clear mitigation'.",
    "",
    "Rules:",
    "- Different modes — do not list 5 variations of the same failure. Spread across causes (execution risk, market risk, motivation drift, dependency on others, opportunity cost, externality).",
    "- Be honest about likelihood. Most failures aren't equally likely.",
    "- No moralising, no platitudes. If you can't think of a real failure mode, leave the array shorter.",
  ].join("\n");

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
        messages: [{ role: "user", content: dump }],
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

  let parsed: { failure_modes?: unknown };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  const out: FailureMode[] = [];
  if (Array.isArray(parsed.failure_modes)) {
    for (const item of parsed.failure_modes) {
      if (typeof item !== "object" || !item) continue;
      const obj = item as Record<string, unknown>;
      const mode = typeof obj.failure_mode === "string" ? obj.failure_mode.trim() : "";
      if (mode.length < 8) continue;
      const lk = typeof obj.likelihood === "number" ? Math.max(1, Math.min(5, Math.round(obj.likelihood))) : 3;
      const mit = typeof obj.mitigation === "string" ? obj.mitigation.trim().slice(0, 400) : "";
      out.push({ failure_mode: mode.slice(0, 400), likelihood: lk, mitigation: mit });
      if (out.length >= count) break;
    }
  }

  if (out.length === 0) return NextResponse.json({ generated: [], note: "model returned no failure modes" });

  const inserts = out.map((m) => ({
    user_id: user.id,
    decision_id: decisionId,
    failure_mode: m.failure_mode,
    likelihood: m.likelihood,
    mitigation: m.mitigation || null,
  }));

  const { data: inserted, error } = await supabase
    .from("decision_premortems")
    .insert(inserts)
    .select("id, decision_id, failure_mode, likelihood, mitigation, status, resolved_at, resolved_note, created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ generated: inserted ?? [] });
}
