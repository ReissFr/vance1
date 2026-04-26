// POST /api/trajectories/generate — generate a 6-month + 12-month
// projection of where the user is likely to be IF they continue at the
// current rate. Grounded in: open goals (with target dates), active
// themes, active policies, recent wins (momentum), recent reflections
// (mindset), open predictions (their own claimed beliefs), recent
// commitments + intentions completed/missed (signal of execution).
//
// Body: {} (no params — uses everything currently active)
// Returns: { trajectory: <inserted row> }
//
// The brain produces TWO narratives (one per horizon) plus key_drivers
// (the inputs it weighted most heavily) and assumptions (what would
// have to remain true). confidence is the brain's honest 1-5 rating.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 2200;

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

export async function POST(_req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const since60 = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const since60Date = since60.slice(0, 10);
  const since14Date = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

  const [goalsRes, themesRes, policiesRes, predRes, winsRes, reflRes, intRes, commRes, decRes] = await Promise.all([
    supabase.from("goals").select("title, target_date, current_state, status, kind").eq("user_id", user.id).neq("status", "achieved").neq("status", "abandoned").limit(30),
    supabase.from("themes").select("title, kind, current_state, status").eq("user_id", user.id).eq("status", "active").limit(20),
    supabase.from("policies").select("name, rule, category, priority").eq("user_id", user.id).eq("active", true).order("priority", { ascending: false }).limit(20),
    supabase.from("predictions").select("claim, confidence, resolve_by, status").eq("user_id", user.id).eq("status", "open").order("resolve_by", { ascending: true }).limit(20),
    supabase.from("wins").select("text, kind, created_at").eq("user_id", user.id).gte("created_at", since60).order("created_at", { ascending: false }).limit(40),
    supabase.from("reflections").select("text, kind, created_at").eq("user_id", user.id).gte("created_at", since60).order("created_at", { ascending: false }).limit(30),
    supabase.from("intentions").select("text, log_date, completed_at").eq("user_id", user.id).gte("log_date", since60Date).order("log_date", { ascending: false }).limit(60),
    supabase.from("commitments").select("text, due_date, status").eq("user_id", user.id).neq("status", "done").gte("due_date", since14Date).limit(30),
    supabase.from("decisions").select("title, choice, expected_outcome, created_at").eq("user_id", user.id).gte("created_at", since60).order("created_at", { ascending: false }).limit(20),
  ]);

  const goals = (goalsRes.data ?? []) as Array<{ title: string; target_date: string | null; current_state: string | null; status: string; kind: string | null }>;
  const themes = (themesRes.data ?? []) as Array<{ title: string; kind: string; current_state: string | null; status: string }>;
  const policies = (policiesRes.data ?? []) as Array<{ name: string; rule: string; category: string; priority: number }>;
  const preds = (predRes.data ?? []) as Array<{ claim: string; confidence: number; resolve_by: string; status: string }>;
  const wins = (winsRes.data ?? []) as Array<{ text: string; kind: string | null; created_at: string }>;
  const refls = (reflRes.data ?? []) as Array<{ text: string; kind: string | null; created_at: string }>;
  const ints = (intRes.data ?? []) as Array<{ text: string; log_date: string; completed_at: string | null }>;
  const comms = (commRes.data ?? []) as Array<{ text: string; due_date: string | null; status: string }>;
  const decs = (decRes.data ?? []) as Array<{ title: string; choice: string | null; expected_outcome: string | null; created_at: string }>;

  const sourceCount =
    goals.length + themes.length + policies.length + preds.length +
    wins.length + refls.length + ints.length + comms.length + decs.length;

  if (sourceCount < 5) {
    return NextResponse.json({ error: "not enough active goals/themes/recent entries to project from" }, { status: 400 });
  }

  const intsCompleted = ints.filter((i) => i.completed_at).length;
  const intsTotal = ints.length;
  const intsRate = intsTotal > 0 ? Math.round((intsCompleted / intsTotal) * 100) : 0;

  const dump = [
    `TODAY: ${new Date().toISOString().slice(0, 10)}`,
    "",
    goals.length ? `OPEN GOALS (${goals.length}):\n${goals.map((g) => `- [${g.kind ?? "goal"}/${g.status}${g.target_date ? `, target ${g.target_date}` : ""}] ${g.title}${g.current_state ? ` — current: ${g.current_state}` : ""}`).join("\n")}` : null,
    themes.length ? `ACTIVE THEMES (${themes.length}):\n${themes.map((t) => `- [${t.kind}] ${t.title}${t.current_state ? ` — ${t.current_state}` : ""}`).join("\n")}` : null,
    policies.length ? `ACTIVE POLICIES (${policies.length}, the user's hard rules):\n${policies.map((p) => `- [${p.category}/p${p.priority}] ${p.name}: ${p.rule}`).join("\n")}` : null,
    preds.length ? `OPEN PREDICTIONS (${preds.length}, what the user themselves expects):\n${preds.map((p) => `- "${p.claim}" · ${p.confidence}% confident · resolves ${p.resolve_by}`).join("\n")}` : null,
    `EXECUTION SIGNAL — INTENTIONS LAST 60 DAYS: ${intsCompleted} completed of ${intsTotal} logged (${intsRate}%)`,
    comms.length ? `OPEN COMMITMENTS (${comms.length}):\n${comms.map((c) => `- ${c.text}${c.due_date ? ` [due ${c.due_date}]` : ""} [${c.status}]`).join("\n")}` : null,
    wins.length ? `RECENT WINS (last 60d, momentum signal):\n${wins.slice(0, 25).map((w) => `- (${w.created_at.slice(0, 10)}) [${w.kind ?? "win"}] ${w.text.slice(0, 200)}`).join("\n")}` : null,
    refls.length ? `RECENT REFLECTIONS (last 60d, mindset signal):\n${refls.slice(0, 20).map((r) => `- (${r.created_at.slice(0, 10)}) [${r.kind ?? "reflection"}] ${r.text.slice(0, 200)}`).join("\n")}` : null,
    decs.length ? `RECENT DECISIONS (last 60d, direction signal):\n${decs.map((d) => `- (${d.created_at.slice(0, 10)}) ${d.title}${d.choice ? ` — chose: ${d.choice}` : ""}${d.expected_outcome ? ` — expected: ${d.expected_outcome}` : ""}`).join("\n")}` : null,
  ].filter(Boolean).join("\n\n");

  const system = [
    "You are running a TRAJECTORY PROJECTION on the user. You have a comprehensive snapshot of their currently-active goals, themes, policies, open predictions, execution rate, recent wins, reflections, decisions. Your job is to project where the user is likely to be in 6 MONTHS and 12 MONTHS IF they continue at their current trajectory — current rate of execution, current themes, current decisions.",
    "",
    "Output strict JSON: { \"body_6m\": string, \"body_12m\": string, \"key_drivers\": string[], \"assumptions\": string[], \"confidence\": 1-5 }. No prose outside the JSON.",
    "",
    "body_6m and body_12m are markdown, second person, ~250-350 words each. Structure each as four short sections:",
    "1. **Where you are** — concrete state at that horizon (income, output, projects shipped, relationships, identity)",
    "2. **What's accelerating** — the things gaining momentum, with specific evidence from current data",
    "3. **What's stalling or breaking** — the tensions, the contradictions, the goals quietly slipping",
    "4. **The version of you at that point** — one paragraph: identity, energy, posture, what they spend their day on",
    "",
    "Rules:",
    "- This is EXTRAPOLATION, not fantasy. Anchor every claim in the data. If the user's intention completion rate is 30%, project a 30% person, not a 90% person.",
    "- Be honest about what is and isn't on track. The 12-month projection should compound the 6-month — show the second half playing out from the first.",
    "- No moralising, no recommending. Show, don't suggest.",
    "- British English. Warm but honest. No em-dashes.",
    "- key_drivers (3-7 strings): the inputs you weighted most heavily, named concretely (e.g. 'Goal: ship Jarvis SaaS by Sept', 'Theme: cofounder search active', 'Execution rate 35% — drag on every goal').",
    "- assumptions (2-5 strings): what would have to stay roughly true (e.g. 'no major health issue', 'current Jarvis traction continues', 'no new founder commitment').",
    "- confidence: 5 = strongly grounded across many signals; 3 = partial; 1 = mostly guess.",
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

  let parsed: { body_6m?: unknown; body_12m?: unknown; key_drivers?: unknown; assumptions?: unknown; confidence?: unknown };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  const body6 = typeof parsed.body_6m === "string" ? parsed.body_6m.trim() : "";
  const body12 = typeof parsed.body_12m === "string" ? parsed.body_12m.trim() : "";
  if (body6.length < 120 || body12.length < 120) {
    return NextResponse.json({ error: "projection bodies too short" }, { status: 502 });
  }

  const drivers = Array.isArray(parsed.key_drivers)
    ? parsed.key_drivers.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim().slice(0, 200)).slice(0, 8)
    : [];
  const assumptions = Array.isArray(parsed.assumptions)
    ? parsed.assumptions.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim().slice(0, 200)).slice(0, 6)
    : [];
  const conf = typeof parsed.confidence === "number" ? Math.max(1, Math.min(5, Math.round(parsed.confidence))) : 3;

  const sourceCounts = {
    goals: goals.length,
    themes: themes.length,
    policies: policies.length,
    predictions: preds.length,
    wins: wins.length,
    reflections: refls.length,
    intentions: intsTotal,
    intentions_completion_rate: intsRate,
    commitments: comms.length,
    decisions: decs.length,
  };

  const { data: inserted, error } = await supabase
    .from("trajectories")
    .insert({
      user_id: user.id,
      body_6m: body6.slice(0, 5000),
      body_12m: body12.slice(0, 5000),
      key_drivers: drivers,
      assumptions,
      confidence: conf,
      source_counts: sourceCounts,
    })
    .select("id, body_6m, body_12m, key_drivers, assumptions, confidence, source_counts, pinned, archived_at, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ trajectory: inserted });
}
