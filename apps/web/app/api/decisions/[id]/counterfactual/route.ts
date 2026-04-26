// POST /api/decisions/[id]/counterfactual — generate a counterfactual
// narrative for a decision: what would have happened if the user had
// chosen the alternative.
//
// Body: { alternative?: string } — the path not taken. If omitted, uses
// the decision's `alternatives` field (first listed). If neither exists,
// 400.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 1400;

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

  let body: { alternative?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const { data: decision, error: decErr } = await supabase
    .from("decisions")
    .select("id, title, choice, context, expected_outcome, alternatives, created_at, outcome_label, outcome_note, reviewed_at")
    .eq("user_id", user.id)
    .eq("id", decisionId)
    .single();
  if (decErr || !decision) return NextResponse.json({ error: "decision not found" }, { status: 404 });

  type DecRow = { id: string; title: string; choice: string | null; context: string | null; expected_outcome: string | null; alternatives: string | null; created_at: string; outcome_label: string | null; outcome_note: string | null; reviewed_at: string | null };
  const dec = decision as DecRow;

  const alternative = (body.alternative ?? "").trim() || (dec.alternatives ?? "").split(/[\n;,]/).map((s) => s.trim()).filter(Boolean)[0];
  if (!alternative) return NextResponse.json({ error: "no alternative provided and decision has no alternatives field" }, { status: 400 });

  // Pull recent themes + reflections + a few wins for grounding the projection.
  const since = new Date(new Date(dec.created_at).getTime() - 60 * 86_400_000).toISOString();
  const sinceUntilDecision = new Date(dec.created_at).toISOString();

  const [themesRes, reflRes, winsRes] = await Promise.all([
    supabase.from("themes").select("title, kind, status, current_state").eq("user_id", user.id).limit(20),
    supabase.from("reflections").select("text, kind, created_at").eq("user_id", user.id).gte("created_at", since).lt("created_at", sinceUntilDecision).order("created_at", { ascending: false }).limit(20),
    supabase.from("wins").select("text, kind, created_at").eq("user_id", user.id).gte("created_at", since).lt("created_at", sinceUntilDecision).order("created_at", { ascending: false }).limit(20),
  ]);

  const themesText = ((themesRes.data ?? []) as Array<{ title: string; kind: string; status: string; current_state: string | null }>)
    .map((t) => `- [${t.kind}/${t.status}] ${t.title}${t.current_state ? `: ${t.current_state}` : ""}`)
    .join("\n");
  const reflText = ((reflRes.data ?? []) as Array<{ text: string; kind: string | null; created_at: string }>)
    .map((r) => `- (${r.created_at.slice(0, 10)}, ${r.kind ?? "reflection"}) ${r.text}`)
    .join("\n");
  const winsText = ((winsRes.data ?? []) as Array<{ text: string; kind: string | null; created_at: string }>)
    .map((w) => `- (${w.created_at.slice(0, 10)}) ${w.text}`)
    .join("\n");

  const dump = [
    `DECISION (${dec.created_at.slice(0, 10)}): ${dec.title}`,
    `PATH TAKEN: ${dec.choice ?? "(unspecified)"}`,
    dec.context ? `CONTEXT AT THE TIME: ${dec.context}` : null,
    dec.expected_outcome ? `EXPECTED OUTCOME (when chosen): ${dec.expected_outcome}` : null,
    dec.outcome_label || dec.outcome_note ? `ACTUAL OUTCOME (since reviewed): ${dec.outcome_label ?? "?"}${dec.outcome_note ? " — " + dec.outcome_note : ""}` : null,
    "",
    `ALTERNATIVE BEING REPLAYED: ${alternative}`,
    "",
    themesText ? `ACTIVE THEMES (the user's broader life context):\n${themesText}` : null,
    reflText ? `RECENT REFLECTIONS BEFORE THE DECISION:\n${reflText}` : null,
    winsText ? `WINS BEFORE THE DECISION:\n${winsText}` : null,
  ].filter(Boolean).join("\n\n");

  const system = [
    "You are running a counterfactual replay on a decision the user has already made and lived past. Your job: simulate the alternative path the user did NOT take.",
    "",
    "Output strict JSON: { \"body\": string, \"credibility\": 1-5 }. No prose outside the JSON. body is markdown.",
    "",
    "Body structure (~250-350 words, markdown, second person):",
    "1. **First weeks** — what would have changed immediately, concretely, given the user's context",
    "2. **At 3-6 months** — likely momentum, complications, energy level",
    "3. **What you'd be doing instead** — daily texture, what would fill the time/money/attention",
    "4. **What you'd have lost** — opportunity costs, things only the taken path made possible",
    "5. **What you'd have gained** — things only the alternative could have given you",
    "6. **The version of you that took this path** — one paragraph on how that 'you' would differ in identity, habits, beliefs",
    "",
    "Rules:",
    "- Be SPECIFIC. Use the user's themes, reflections, wins as evidence the projection is grounded. Reference them implicitly — do not list 'based on theme X' explicitly.",
    "- Write as if it had really happened. No 'might' / 'could' hedging in every sentence — projections, not weather forecasts. But honesty over confidence: where reality is genuinely unknowable, name the fork.",
    "- No moralising about which path is better. The user chose. You are illuminating, not judging.",
    "- British English. Warm but honest. No em-dashes.",
    "- credibility is your honest self-rating: 5 = strong projection well-grounded in evidence; 3 = partial evidence; 1 = mostly speculation.",
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

  let parsed: { body?: unknown; credibility?: unknown };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  const narrative = typeof parsed.body === "string" ? parsed.body.trim() : "";
  if (narrative.length < 80) return NextResponse.json({ error: "narrative too short" }, { status: 502 });
  const cred = typeof parsed.credibility === "number" ? Math.max(1, Math.min(5, Math.round(parsed.credibility))) : 3;

  const { data: inserted, error } = await supabase
    .from("counterfactuals")
    .insert({
      user_id: user.id,
      decision_id: decisionId,
      alternative_choice: alternative.slice(0, 400),
      body: narrative.slice(0, 4000),
      credibility: cred,
    })
    .select("id, decision_id, alternative_choice, body, credibility, user_note, verdict, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ counterfactual: inserted });
}
