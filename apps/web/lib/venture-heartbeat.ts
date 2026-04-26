// §182 — venture heartbeat (the autonomous CEO loop core).
//
// Pulled out of /api/ventures/[id]/operator-loop so both the user-trigger
// route AND the cron poller (/api/ventures/cron) call the same code path.
//
// Per-venture autonomy controls dispatch:
//   manual         — heartbeat fires only on user request; ALL decisions queue
//                    for review (auto/notify/approve all become 'queued').
//   supervised     — heartbeat fires only on user request; auto+notify execute
//                    via start_errand substrate, approve queues.
//   autonomous     — same as supervised PLUS cron fires the heartbeat on
//                    schedule. Default for trusted ventures.
//   full_autopilot — same as autonomous PLUS approve-tier also dispatches.
//                    Use when JARVIS has enough operator memory to fly solo.
//
// Global panic stop (profiles.ventures_panic_stop_at) overrides everything:
// the heartbeat refuses to dispatch any decision while the stop is set, even
// for full_autopilot ventures. Decisions still get proposed and queued so the
// user can approve them manually after clearing the stop.
//
// Each dispatched decision spawns an errand task and links execution_task_id
// + execution_status='pending' so the venture detail page can show
// "running / done / failed" against each silent decision.

import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { dispatchNotification } from "./notify";

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 4500;

type DecisionMatrix = {
  auto?: { max_spend_pence?: number; kinds?: string[] };
  notify?: { max_spend_pence?: number; kinds?: string[] };
  approve?: { kinds?: string[] };
};

type ProposedDecision = {
  kind: string;
  title: string;
  body: string;
  reasoning?: string;
  signals_consulted?: { signal_id: string; summary: string }[];
  estimated_spend_pence?: number;
  confidence: number;
};

type Autonomy = "manual" | "supervised" | "autonomous" | "full_autopilot";

export type HeartbeatResult = {
  ok: boolean;
  heartbeat_id: string;
  model: string;
  latency_ms: number;
  signals_consumed: number;
  decisions_proposed: number;
  auto_dispatched: number;
  notify_dispatched: number;
  approve_dispatched: number;
  queued: number;
  panic_stop_active: boolean;
  decisions: { id: string; tier: string; status: string; kind: string; title: string; execution_task_id: string | null }[];
  error?: string;
};

function isOverloaded(e: unknown): boolean {
  if (typeof e !== "object" || !e) return false;
  const err = e as { status?: number; error?: { type?: string } };
  return err.status === 529 || err.error?.type === "overloaded_error";
}

function classifyTier(d: ProposedDecision, matrix: DecisionMatrix): "auto" | "notify" | "approve" {
  const spend = Math.max(0, Math.round(d.estimated_spend_pence ?? 0));
  const approveKinds = new Set(matrix.approve?.kinds ?? []);
  const notifyKinds = new Set(matrix.notify?.kinds ?? []);
  const autoKinds = new Set(matrix.auto?.kinds ?? []);
  if (approveKinds.has(d.kind)) return "approve";
  const autoCap = matrix.auto?.max_spend_pence ?? 0;
  const notifyCap = matrix.notify?.max_spend_pence ?? 0;
  if (autoKinds.has(d.kind) && spend <= autoCap) return "auto";
  if (notifyKinds.has(d.kind) || (autoKinds.has(d.kind) && spend > autoCap && spend <= notifyCap)) return "notify";
  if (spend > notifyCap) return "approve";
  return "approve";
}

export function nextHeartbeatFromCadence(cadence: string): Date | null {
  const now = Date.now();
  if (cadence === "hourly") return new Date(now + 60 * 60 * 1000);
  if (cadence === "twice_daily") return new Date(now + 12 * 60 * 60 * 1000);
  if (cadence === "daily") return new Date(now + 24 * 60 * 60 * 1000);
  if (cadence === "weekly") return new Date(now + 7 * 24 * 60 * 60 * 1000);
  return null;
}

function stripFence(t: string): string {
  return t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function shouldDispatch(autonomy: Autonomy, tier: "auto" | "notify" | "approve"): boolean {
  if (autonomy === "manual") return false;
  if (autonomy === "supervised") return tier === "auto" || tier === "notify";
  if (autonomy === "autonomous") return tier === "auto" || tier === "notify";
  if (autonomy === "full_autopilot") return true;
  return false;
}

function decisionToErrandGoal(kind: string, title: string, body: string, ventureName: string): string {
  return `[${ventureName}] ${kind}: ${title}\n\n${body}`;
}

export async function runVentureHeartbeat(
  supabase: SupabaseClient,
  userId: string,
  ventureId: string,
): Promise<HeartbeatResult> {
  const t0 = Date.now();
  const heartbeatId = crypto.randomUUID();

  const empty = (overrides: Partial<HeartbeatResult> = {}): HeartbeatResult => ({
    ok: false,
    heartbeat_id: heartbeatId,
    model: MODEL,
    latency_ms: Date.now() - t0,
    signals_consumed: 0,
    decisions_proposed: 0,
    auto_dispatched: 0,
    notify_dispatched: 0,
    approve_dispatched: 0,
    queued: 0,
    panic_stop_active: false,
    decisions: [],
    ...overrides,
  });

  const { data: venture, error: venErr } = await supabase
    .from("ventures")
    .select("*")
    .eq("user_id", userId)
    .eq("id", ventureId)
    .single();
  if (venErr || !venture) return empty({ error: "venture not found" });
  if (venture.status === "killed") return empty({ error: "venture is killed" });
  if (venture.status === "paused") return empty({ error: "venture is paused" });
  if (venture.paused_at) return empty({ error: "venture is paused (heartbeat halted)" });

  const { data: profile } = await supabase
    .from("profiles")
    .select("ventures_panic_stop_at, mobile_e164")
    .eq("id", userId)
    .single();
  const panicStopActive = Boolean(profile?.ventures_panic_stop_at);

  const autonomy = (venture.autonomy ?? "supervised") as Autonomy;
  const matrix = (venture.decision_matrix ?? {}) as DecisionMatrix;

  const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [signalsRes, metricsRes, recentDecisionsRes] = await Promise.all([
    supabase
      .from("venture_signals")
      .select("*")
      .eq("user_id", userId)
      .eq("venture_id", ventureId)
      .is("processed_at", null)
      .order("captured_at", { ascending: false })
      .limit(40),
    supabase
      .from("venture_metrics")
      .select("metric_kind, value, captured_for_date")
      .eq("user_id", userId)
      .eq("venture_id", ventureId)
      .gte("captured_for_date", fourteenDaysAgo.slice(0, 10))
      .order("captured_for_date", { ascending: false })
      .limit(200),
    supabase
      .from("venture_decisions")
      .select("kind, title, body, status, tier, executed_at, outcome_note")
      .eq("user_id", userId)
      .eq("venture_id", ventureId)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const signals = signalsRes.data ?? [];
  const metrics = metricsRes.data ?? [];
  const recentDecisions = recentDecisionsRes.data ?? [];

  const promptSystem = [
    "You are JARVIS operating in CEO MODE for one of the user's businesses.",
    "Your role is operator: you read the venture's thesis + operator memory +",
    "current signals + metrics + recent decisions, and you propose a ranked",
    "list of operational decisions to execute now.",
    "",
    "Your output is one strict JSON object with a `decisions` array. Each",
    "decision has:",
    '  kind: short snake_case label, ideally one of the kinds named in the',
    "        venture's decision matrix (copy_change, pricing_change, feature_flag,",
    "        support_reply, outreach, ad_campaign, partnership_outreach, pivot,",
    "        kill, human_hire, contract_sign, product_add, product_remove). New",
    "        kinds allowed when the existing list doesn't fit.",
    "  title: <=120 char headline.",
    "  body: 2-6 sentences in plain English: WHAT to do, WHY (citing the signal",
    "        or metric or trend), what's the EXPECTED EFFECT.",
    "  reasoning: short trace of your inference.",
    "  signals_consulted: array of {signal_id, summary} pointing back to the",
    "                     specific signals that drove this decision (use the",
    "                     IDs from the signals list below).",
    "  estimated_spend_pence: integer >=0, in pence. 0 means no money committed.",
    "  confidence: integer 1-5 (1=hunch, 5=strong evidence). BE HONEST. The",
    "              user reads this — under-claiming is preferred to over-claiming.",
    "",
    "Output ONLY raw JSON. No prose. No code fences. No commentary.",
    "",
    "Rules:",
    "- Propose 0-6 decisions per heartbeat. Quality over quantity.",
    "- If signals are weak or there are no clear opportunities, return {decisions: []}.",
    "  Doing nothing is a valid output.",
    "- Do NOT propose 'kill' lightly. Only when kill_criteria fires unambiguously.",
    "- High-spend or irreversible decisions (pivot/kill/human_hire/contract_sign)",
    "  should always have confidence >=4. The user will see the queue.",
    "- Honour the venture's decision_matrix when shaping decision.kind values.",
    "- Each decision must cite at least one signal_id in signals_consulted",
    "  UNLESS it's a metric-driven decision (then leave signals_consulted empty",
    "  and reference the metric in body+reasoning).",
  ].join("\n");

  const promptUser = [
    `# Venture: ${venture.name}`,
    `## Status: ${venture.status} · cadence: ${venture.cadence} · autonomy: ${autonomy} · revision: ${venture.thesis_revision}`,
    `## Budget: ${venture.budget_pence}p · Spent: ${venture.spent_pence}p · Runway: ${venture.budget_pence - venture.spent_pence}p`,
    "",
    "## Thesis",
    venture.thesis,
    "",
    venture.kill_criteria ? `## Kill criteria\n${venture.kill_criteria}\n` : "",
    "## Operator memory (current strategy doc)",
    venture.operator_memory || "(empty)",
    "",
    "## Decision matrix",
    JSON.stringify(matrix),
    "",
    "## Unprocessed signals",
    signals.length === 0
      ? "(none)"
      : signals.map((s: { id: string; kind: string; weight: number; captured_at: string; body: string; source: string | null }) =>
          `- [${s.id}] kind=${s.kind} weight=${s.weight} captured=${s.captured_at}\n  ${s.body}\n  source=${s.source ?? "?"}`,
        ).join("\n"),
    "",
    "## Last 14 days of metrics",
    metrics.length === 0
      ? "(none)"
      : metrics.map((m: { metric_kind: string; value: number; captured_for_date: string }) =>
          `- ${m.captured_for_date} ${m.metric_kind}=${m.value}`,
        ).join("\n"),
    "",
    "## Decisions in the last 7 days",
    recentDecisions.length === 0
      ? "(none)"
      : recentDecisions.map((d: { tier: string; status: string; kind: string; title: string; outcome_note: string | null }) =>
          `- [${d.tier}/${d.status}] ${d.kind}: ${d.title}${d.outcome_note ? ` -> outcome: ${d.outcome_note}` : ""}`,
        ).join("\n"),
    "",
    "Now output the JSON.",
  ].filter(Boolean).join("\n");

  const anthropic = new Anthropic();
  let modelUsed = MODEL;
  let raw = "";
  try {
    const r = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: promptSystem,
      messages: [{ role: "user", content: promptUser }],
    });
    raw = r.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
  } catch (e) {
    if (!isOverloaded(e)) {
      return empty({ error: "Haiku call failed" });
    }
    modelUsed = FALLBACK_MODEL;
    const r = await anthropic.messages.create({
      model: FALLBACK_MODEL,
      max_tokens: MAX_TOKENS,
      system: promptSystem,
      messages: [{ role: "user", content: promptUser }],
    });
    raw = r.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
  }

  let parsed: { decisions?: ProposedDecision[] } = {};
  try { parsed = JSON.parse(stripFence(raw)); } catch {
    parsed = { decisions: [] };
  }

  const proposed = (parsed.decisions ?? []).filter((d) => {
    if (!d || typeof d !== "object") return false;
    if (typeof d.kind !== "string" || d.kind.length < 2) return false;
    if (typeof d.title !== "string" || d.title.length < 2 || d.title.length > 280) return false;
    if (typeof d.body !== "string" || d.body.length < 4 || d.body.length > 4000) return false;
    if (typeof d.confidence !== "number" || d.confidence < 1 || d.confidence > 5) return false;
    return true;
  });

  // Classify + decide dispatch policy
  const classified = proposed.map((d) => {
    const tier = classifyTier(d, matrix);
    const dispatch = !panicStopActive && shouldDispatch(autonomy, tier);
    return { d, tier, dispatch };
  });

  const inserts = classified.map(({ d, tier, dispatch }) => {
    const baseStatus = tier === "auto" ? "auto_executed"
      : tier === "notify" ? "notified"
      : "queued";
    const status = dispatch ? baseStatus : "queued";
    return {
      user_id: userId,
      venture_id: ventureId,
      heartbeat_id: heartbeatId,
      kind: d.kind,
      title: d.title.slice(0, 280),
      body: d.body.slice(0, 4000),
      reasoning: d.reasoning ? d.reasoning.slice(0, 4000) : null,
      signals_consulted: d.signals_consulted ?? [],
      estimated_spend_pence: Math.max(0, Math.round(d.estimated_spend_pence ?? 0)),
      confidence: Math.max(1, Math.min(5, Math.round(d.confidence))),
      tier,
      status,
      execution_status: dispatch ? "pending" : null,
      executed_at: dispatch && (tier === "auto" || tier === "notify") ? new Date().toISOString() : null,
      outcome_postmortem_due_at: dispatch && (tier === "auto" || tier === "notify")
        ? new Date(Date.now() + 21 * 86_400_000).toISOString()
        : null,
    };
  });

  let inserted: { id: string; tier: string; status: string; kind: string; title: string; body: string; estimated_spend_pence: number; execution_status: string | null }[] = [];
  if (inserts.length > 0) {
    const { data: ins, error: insErr } = await supabase
      .from("venture_decisions")
      .insert(inserts)
      .select("id, tier, status, kind, title, body, estimated_spend_pence, execution_status");
    if (insErr) return empty({ error: insErr.message, panic_stop_active: panicStopActive });
    inserted = ins ?? [];
  }

  // Dispatch decisions whose execution_status is 'pending' through start_errand.
  // The errand runner already enforces budget + WhatsApp checkpoints.
  const baseUrl =
    process.env.JARVIS_INTERNAL_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.TWILIO_PUBLIC_BASE_URL ||
    "http://localhost:3030";

  const dispatchResults: { decision_id: string; task_id: string | null }[] = [];
  for (const dec of inserted) {
    if (dec.execution_status !== "pending") {
      dispatchResults.push({ decision_id: dec.id, task_id: null });
      continue;
    }
    const goal = decisionToErrandGoal(dec.kind, dec.title, dec.body, venture.name);
    const budgetGbp = Math.max(0.01, dec.estimated_spend_pence / 100);
    const { data: taskRow, error: taskErr } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        kind: "errand",
        prompt: goal,
        args: {
          goal,
          budget_gbp: budgetGbp,
          threshold_gbp: Math.max(1, Math.min(budgetGbp, 100)),
          deadline: null,
          notify: true,
          venture_id: ventureId,
          venture_decision_id: dec.id,
        },
        device_target: "server",
        status: "queued",
        scheduled_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (taskErr || !taskRow) {
      await supabase
        .from("venture_decisions")
        .update({ execution_status: "failed", outcome_note: `dispatch failed: ${taskErr?.message ?? "unknown"}` })
        .eq("id", dec.id);
      dispatchResults.push({ decision_id: dec.id, task_id: null });
      continue;
    }
    await supabase
      .from("venture_decisions")
      .update({ execution_task_id: taskRow.id, execution_status: "running" })
      .eq("id", dec.id);
    void fetch(`${baseUrl}/api/tasks/run-errand`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: taskRow.id }),
    }).catch((e) => {
      console.warn("[venture-heartbeat] errand trigger failed:", e);
    });
    dispatchResults.push({ decision_id: dec.id, task_id: taskRow.id });
  }

  // Mark consumed signals
  if (signals.length > 0) {
    const signalIds = signals.map((s: { id: string }) => s.id);
    await supabase
      .from("venture_signals")
      .update({ processed_at: new Date().toISOString() })
      .eq("user_id", userId)
      .in("id", signalIds);
  }

  // Tally
  const autoDispatched = inserted.filter((d) => d.tier === "auto" && d.execution_status === "pending").length;
  const notifyDispatched = inserted.filter((d) => d.tier === "notify" && d.execution_status === "pending").length;
  const approveDispatched = inserted.filter((d) => d.tier === "approve" && d.execution_status === "pending").length;
  const queued = inserted.filter((d) => d.status === "queued").length;
  const dispatchedTotal = autoDispatched + notifyDispatched + approveDispatched;

  const stopMarker = panicStopActive ? " [PANIC STOP — nothing dispatched]" : "";
  const heartbeatNote = `\n\n## HB ${new Date().toISOString().slice(0, 16)} (${autonomy})${stopMarker}\npulled ${signals.length} signals, ${metrics.length} metric points; proposed ${inserted.length} decisions (${dispatchedTotal} dispatched, ${queued} queued).${inserted.slice(0, 4).map((d) => `\n- [${d.tier}${d.execution_status === "pending" ? "/dispatched" : ""}] ${d.kind}: ${d.title}`).join("")}`;
  const newMemory = (venture.operator_memory + heartbeatNote).slice(-50_000);

  const next = nextHeartbeatFromCadence(venture.cadence);
  await supabase
    .from("ventures")
    .update({
      operator_memory: newMemory,
      last_heartbeat_at: new Date().toISOString(),
      next_heartbeat_at: next ? next.toISOString() : null,
    })
    .eq("user_id", userId)
    .eq("id", ventureId);

  // WhatsApp digest if anything notable happened (and we have a number).
  if ((dispatchedTotal > 0 || queued > 0) && profile?.mobile_e164) {
    const lines: string[] = [];
    lines.push(`🧭 ${venture.name} HB${panicStopActive ? " (PANIC STOP)" : ""}`);
    if (dispatchedTotal > 0) {
      lines.push(`Dispatched ${dispatchedTotal}:`);
      for (const dec of inserted.filter((d) => d.execution_status === "pending").slice(0, 5)) {
        lines.push(`• [${dec.tier}] ${dec.title}`);
      }
    }
    if (queued > 0) {
      lines.push(`Queued ${queued} for approval:`);
      for (const dec of inserted.filter((d) => d.status === "queued").slice(0, 5)) {
        lines.push(`• ${dec.title}`);
      }
    }
    const body = lines.join("\n").slice(0, 1500);
    try {
      const { data: notif, error: notifErr } = await supabase
        .from("notifications")
        .insert({
          user_id: userId,
          channel: "whatsapp",
          to_e164: profile.mobile_e164,
          body,
          status: "queued",
        })
        .select("id")
        .single();
      if (!notifErr && notif) {
        await dispatchNotification(supabase, notif.id);
      }
    } catch (e) {
      console.warn("[venture-heartbeat] digest failed:", e);
    }
  }

  return {
    ok: true,
    heartbeat_id: heartbeatId,
    model: modelUsed,
    latency_ms: Date.now() - t0,
    signals_consumed: signals.length,
    decisions_proposed: inserted.length,
    auto_dispatched: autoDispatched,
    notify_dispatched: notifyDispatched,
    approve_dispatched: approveDispatched,
    queued,
    panic_stop_active: panicStopActive,
    decisions: inserted.map((d, i) => ({
      id: d.id,
      tier: d.tier,
      status: d.status,
      kind: d.kind,
      title: d.title,
      execution_task_id: dispatchResults[i]?.task_id ?? null,
    })),
  };
}
