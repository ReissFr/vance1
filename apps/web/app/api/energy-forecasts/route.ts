// POST /api/energy-forecasts — generate a predictive read for a target
// date (default tomorrow). Returns the forecast row including narrative
// and recommendations. Idempotent per (user_id, forecast_date) — calling
// for the same date overwrites the existing forecast.
//
// GET /api/energy-forecasts — list recent forecasts.
//   ?status=upcoming|scored|unscored|all (default all)
//   ?limit=N (default 30, max 100)

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 1400;

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { forecast_date?: string } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  let targetDate: string;
  if (typeof body.forecast_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.forecast_date)) {
    targetDate = body.forecast_date;
  } else {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    targetDate = tomorrow.toISOString().slice(0, 10);
  }

  const t0 = Date.now();
  const targetDow = new Date(targetDate + "T00:00:00Z").getUTCDay();
  const targetDowName = DOW_NAMES[targetDow] ?? "Mon";

  const since14 = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const tomorrowEnd = new Date(targetDate + "T23:59:59Z").toISOString();

  const [chkRes, stdRes, intRes, comRes, decRes] = await Promise.all([
    supabase.from("daily_checkins").select("log_date, energy, mood, focus, note").eq("user_id", user.id).gte("log_date", since30).order("log_date", { ascending: false }).limit(30),
    supabase.from("standups").select("log_date, today, blockers").eq("user_id", user.id).gte("log_date", since14).order("log_date", { ascending: false }).limit(14),
    supabase.from("intentions").select("text, log_date, completed_at").eq("user_id", user.id).eq("log_date", targetDate).order("created_at", { ascending: true }).limit(8),
    supabase.from("commitments").select("commitment_text, deadline, status").eq("user_id", user.id).eq("status", "open").lte("deadline", tomorrowEnd).order("deadline", { ascending: true, nullsFirst: false }).limit(10),
    supabase.from("decisions").select("title, choice, created_at").eq("user_id", user.id).gte("created_at", new Date(Date.now() - 5 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(10),
  ]);

  const chks = (chkRes.data ?? []) as Array<{ log_date: string; energy: number | null; mood: number | null; focus: number | null; note: string | null }>;
  const stds = (stdRes.data ?? []) as Array<{ log_date: string; today: string | null; blockers: string | null }>;
  const ints = (intRes.data ?? []) as Array<{ text: string; log_date: string; completed_at: string | null }>;
  const coms = (comRes.data ?? []) as Array<{ commitment_text: string; deadline: string | null; status: string }>;
  const decs = (decRes.data ?? []) as Array<{ title: string; choice: string | null; created_at: string }>;

  const totalEvidence = chks.length + stds.length + ints.length + coms.length + decs.length;
  if (chks.length < 3) {
    return NextResponse.json({ error: "need at least 3 daily check-ins to forecast — log a few days first" }, { status: 400 });
  }

  // Same-day-of-week aggregation (last 4 occurrences max within 30d)
  const targetDowDate = new Date(targetDate + "T00:00:00Z").getUTCDay();
  const sameDow = chks.filter((c) => new Date(c.log_date + "T00:00:00Z").getUTCDay() === targetDowDate);
  const avg = (arr: Array<number | null>): number | null => {
    const n = arr.filter((x): x is number => typeof x === "number");
    if (n.length === 0) return null;
    return Math.round((n.reduce((a, b) => a + b, 0) / n.length) * 10) / 10;
  };
  const sameDowAvg = {
    energy: avg(sameDow.map((c) => c.energy)),
    mood: avg(sameDow.map((c) => c.mood)),
    focus: avg(sameDow.map((c) => c.focus)),
    n: sameDow.length,
  };
  const overallAvg = {
    energy: avg(chks.map((c) => c.energy)),
    mood: avg(chks.map((c) => c.mood)),
    focus: avg(chks.map((c) => c.focus)),
    n: chks.length,
  };
  // Recent 7d trend
  const recent7 = chks.slice(0, 7);
  const recent7Avg = {
    energy: avg(recent7.map((c) => c.energy)),
    mood: avg(recent7.map((c) => c.mood)),
    focus: avg(recent7.map((c) => c.focus)),
    n: recent7.length,
  };

  // Use last-48h decisions as the proxy for recent decision drain (no
  // weight column on the table — count is the heuristic).
  const recent48hDecisions = decs.filter((d) => Date.now() - new Date(d.created_at).getTime() < 48 * 3600_000);

  const evidenceLines: string[] = [];
  evidenceLines.push(`TARGET DATE: ${targetDate} (${targetDowName})`);
  evidenceLines.push("");
  evidenceLines.push("CHECK-IN BASELINES (1-5):");
  evidenceLines.push(`- Overall (last ${overallAvg.n}d): energy ${overallAvg.energy ?? "?"}, mood ${overallAvg.mood ?? "?"}, focus ${overallAvg.focus ?? "?"}`);
  evidenceLines.push(`- Recent 7d: energy ${recent7Avg.energy ?? "?"}, mood ${recent7Avg.mood ?? "?"}, focus ${recent7Avg.focus ?? "?"}`);
  evidenceLines.push(`- Same day-of-week (${targetDowName}, ${sameDowAvg.n} samples): energy ${sameDowAvg.energy ?? "?"}, mood ${sameDowAvg.mood ?? "?"}, focus ${sameDowAvg.focus ?? "?"}`);
  evidenceLines.push("");

  if (chks.length) {
    evidenceLines.push("RECENT CHECK-IN STREAM (newest first):");
    for (const c of chks.slice(0, 14)) {
      const dow = DOW_NAMES[new Date(c.log_date + "T00:00:00Z").getUTCDay()] ?? "?";
      evidenceLines.push(`- ${c.log_date} ${dow}: e${c.energy ?? "?"}/m${c.mood ?? "?"}/f${c.focus ?? "?"}${c.note ? " — " + c.note.slice(0, 140) : ""}`);
    }
    evidenceLines.push("");
  }

  if (stds.length) {
    evidenceLines.push("RECENT STANDUPS (today plan + blockers):");
    for (const s of stds.slice(0, 6)) {
      const parts = [s.today && `t: ${s.today.slice(0, 160)}`, s.blockers && `b: ${s.blockers.slice(0, 120)}`].filter(Boolean).join(" | ");
      if (parts) evidenceLines.push(`- ${s.log_date}: ${parts}`);
    }
    evidenceLines.push("");
  }

  if (decs.length) {
    evidenceLines.push("RECENT DECISIONS (last 5d — high count drains next-day energy):");
    for (const d of decs) {
      const ago = Math.floor((Date.now() - new Date(d.created_at).getTime()) / 3600_000);
      evidenceLines.push(`- ${ago}h ago: ${d.title}${d.choice ? " — " + d.choice.slice(0, 80) : ""}`);
    }
    evidenceLines.push("");
  }

  if (coms.length) {
    evidenceLines.push("OPEN COMMITMENTS DUE BY THEN:");
    for (const c of coms) evidenceLines.push(`- ${c.commitment_text.slice(0, 140)}${c.deadline ? ` (due ${c.deadline.slice(0, 10)})` : ""}`);
    evidenceLines.push("");
  }

  if (ints.length) {
    evidenceLines.push(`INTENTIONS ALREADY LOGGED FOR ${targetDate}:`);
    for (const i of ints) evidenceLines.push(`- ${i.completed_at ? "✓" : "○"} ${i.text.slice(0, 160)}`);
    evidenceLines.push("");
  }

  const counts = {
    checkins: chks.length,
    standups: stds.length,
    intentions: ints.length,
    commitments: coms.length,
    decisions: decs.length,
    recent_48h_decisions: recent48hDecisions.length,
    same_dow_samples: sameDowAvg.n,
  };

  const system = [
    "You are JARVIS forecasting the user's energy / mood / focus for a specific upcoming day, based on their recent check-in arc, day-of-week patterns, calendar load, recent heavy decisions, and any commitments due by then.",
    "",
    "Output strict JSON ONLY:",
    `{"energy_pred": 1-5, "mood_pred": 1-5, "focus_pred": 1-5, "confidence": 1-5, "narrative": "...", "recommendations": ["...", "..."]}`,
    "",
    "Forecast rules:",
    "- Anchor predictions in the same-day-of-week average if available (the user has weekday patterns). Modulate from there using recent 7d trend, decision weight, and calendar load.",
    "- Heavy decisions in the last 48h drain next-day energy by ~1 point.",
    "- A drift in mood from baseline by >1 point in last 3 days carries forward 60% of the gap.",
    "- Confidence: 5 if same-DOW samples ≥3 and recent stream is consistent. 1 if you're guessing from limited data.",
    "- Don't be a coach. Don't be saccharine. Don't write 'remember to take care of yourself'.",
    "",
    "Narrative rules:",
    "- 2-3 sentences in second person ('you'll wake up...', 'expect...').",
    "- Anchor every claim in evidence ('because last 3 Wednesdays averaged energy 2', 'because 2 heavy decisions yesterday').",
    "- Name the SHAPE of the day (low-energy slow start, mid-day dip, focus window 14:00-16:30, etc) rather than just a number.",
    "- British English. No em-dashes. No emoji. No clichés.",
    "",
    "Recommendations rules:",
    "- 2-4 items. Each is one short imperative sentence.",
    "- Mix protective (don't book deep work in the morning) and productive (use the 14:00 window for the brain refactor).",
    "- Concrete and specific to the day, not generic life advice.",
    "- Reference actual entries when relevant (the partnership call you have at 10am, the brain refactor you've been pushing).",
  ].join("\n");

  const userMsg = ["EVIDENCE:", "", evidenceLines.join("\n")].join("\n");

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

  let parsed: {
    energy_pred?: number; mood_pred?: number; focus_pred?: number;
    confidence?: number; narrative?: string; recommendations?: unknown;
  };
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "model output was not valid JSON", raw: raw.slice(0, 400) }, { status: 502 });
  }

  const clamp = (n: unknown): number | null => {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    return Math.max(1, Math.min(5, Math.round(n)));
  };
  const energy = clamp(parsed.energy_pred);
  const mood = clamp(parsed.mood_pred);
  const focus = clamp(parsed.focus_pred);
  const confidence = clamp(parsed.confidence);
  if (energy == null || mood == null || focus == null || confidence == null) {
    return NextResponse.json({ error: "model returned missing/invalid scores", raw: raw.slice(0, 400) }, { status: 502 });
  }
  const narrative = typeof parsed.narrative === "string" ? parsed.narrative.trim().slice(0, 1200) : "";
  if (!narrative) return NextResponse.json({ error: "model returned no narrative" }, { status: 502 });
  const recsRaw = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  const recommendations = recsRaw
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((s) => s.trim().slice(0, 280))
    .slice(0, 4);

  const sourceSummary = `e${energy}/m${mood}/f${focus} for ${targetDate} (${targetDowName}) from ${totalEvidence} signals: ${counts.checkins} checkins, ${counts.same_dow_samples} same-DOW, ${counts.recent_48h_decisions} 48h-decisions`;
  const latencyMs = Date.now() - t0;

  // Upsert (one forecast per (user, date))
  const { data: inserted, error } = await supabase
    .from("energy_forecasts")
    .upsert({
      user_id: user.id,
      forecast_date: targetDate,
      forecast_at: new Date().toISOString(),
      energy_pred: energy,
      mood_pred: mood,
      focus_pred: focus,
      confidence,
      narrative,
      recommendations,
      source_summary: sourceSummary,
      source_counts: counts,
      latency_ms: latencyMs,
      model,
      actual_energy: null,
      actual_mood: null,
      actual_focus: null,
      accuracy_score: null,
      scored_at: null,
    }, { onConflict: "user_id,forecast_date" })
    .select("id, forecast_date, forecast_at, energy_pred, mood_pred, focus_pred, confidence, narrative, recommendations, source_summary, source_counts, actual_energy, actual_mood, actual_focus, accuracy_score, scored_at, user_note, pinned, latency_ms, model, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ forecast: inserted });
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "all";
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.max(1, Math.min(100, isNaN(limitRaw) ? 30 : limitRaw));

  let q = supabase
    .from("energy_forecasts")
    .select("id, forecast_date, forecast_at, energy_pred, mood_pred, focus_pred, confidence, narrative, recommendations, source_summary, source_counts, actual_energy, actual_mood, actual_focus, accuracy_score, scored_at, user_note, pinned, latency_ms, model, created_at")
    .eq("user_id", user.id);

  const today = new Date().toISOString().slice(0, 10);
  if (status === "upcoming") q = q.gte("forecast_date", today);
  else if (status === "scored") q = q.not("scored_at", "is", null);
  else if (status === "unscored") q = q.is("scored_at", null).lt("forecast_date", today);

  q = q.order("forecast_date", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as Array<{ accuracy_score: number | null; scored_at: string | null }>;

  const scored = rows.filter((r) => r.scored_at != null && r.accuracy_score != null);
  const calibration = scored.length
    ? {
        scored: scored.length,
        avg_accuracy: Math.round((scored.reduce((s, r) => s + (r.accuracy_score ?? 0), 0) / scored.length) * 10) / 10,
      }
    : null;

  return NextResponse.json({ forecasts: data ?? [], calibration });
}
