// Automation engine. Triggers (cron, geofence, email, bank, payment, calendar)
// flow into dispatchTrigger(), which finds matching automations for the user,
// records a run row, and executes the action chain step by step.
//
// Action chain shape (jsonb on automations.action_chain):
//   [
//     { "tool": "send_whatsapp",  "args": { "body": "Uber home from {{place}}?" } },
//     { "tool": "wait_for_reply", "args": { "timeout_min": 10 } },
//     { "tool": "concierge_agent","args": { "goal": "Order Uber from {{place}} to home" } }
//   ]
//
// Steps are dispatched against the brain's tool registry (TOOLS_BY_NAME), so any
// tool the brain can call, an automation can call. Two pseudo-tools are handled
// here directly (not in the registry) because they're engine-specific:
//   - send_whatsapp / send_sms / make_call → all map to notify_user
//   - wait_for_reply → pauses the run with status='awaiting_approval'
//
// {{var}} substitution: any string in args is templated against the trigger
// payload merged with saved context (place label, person label, etc).
//
// Rate limit: per-user cap of MAX_RUNS_PER_DAY total automation_runs in the last
// 24h. Beyond that, the engine logs and skips. Prevents a buggy chain looping
// the user's costs into the ground.

import type { SupabaseClient } from "@supabase/supabase-js";
import { TOOLS_BY_NAME, type ToolContext } from "@jarvis/agent";
import { makeVoyageEmbed } from "@jarvis/agent";
import { dispatchNotification } from "./notify";

export type TriggerKind =
  | "cron"
  | "location_arrived"
  | "location_left"
  | "email_received"
  | "bank_txn"
  | "payment_received"
  | "calendar_event"
  | "periodic_check"
  | "inbound_message";

export type TriggerPayload = Record<string, unknown>;

export type ActionStep = {
  tool: string;
  args: Record<string, unknown>;
};

type AutomationRow = {
  id: string;
  user_id: string;
  title: string;
  trigger_kind: TriggerKind;
  trigger_spec: Record<string, unknown>;
  action_chain: ActionStep[];
  ask_first: boolean;
  enabled: boolean;
  fire_count: number;
};

type DispatchResult = {
  matched: number;
  fired: string[];      // automation_run ids
  rate_limited: number;
  skipped_no_match: number;
  // True if any matched rule had trigger_spec.swallow === true. Used by the
  // inbound_message handler to skip the conversational brain reply when a
  // photo-inbox-style rule has already consumed the message.
  swallowed: boolean;
};

const MAX_RUNS_PER_DAY = 200;

export async function dispatchTrigger(
  admin: SupabaseClient,
  kind: TriggerKind,
  userId: string,
  payload: TriggerPayload,
): Promise<DispatchResult> {
  const result: DispatchResult = {
    matched: 0,
    fired: [],
    rate_limited: 0,
    skipped_no_match: 0,
    swallowed: false,
  };

  const { data: rules, error } = await admin
    .from("automations")
    .select("id, user_id, title, trigger_kind, trigger_spec, action_chain, ask_first, enabled, fire_count")
    .eq("user_id", userId)
    .eq("trigger_kind", kind)
    .eq("enabled", true);

  if (error) {
    console.error("[automation-engine] rule query failed:", error.message);
    return result;
  }

  if (!rules?.length) return result;

  for (const rule of rules as AutomationRow[]) {
    const matchInfo = await matchTrigger(admin, rule, payload);
    if (!matchInfo.matched) {
      result.skipped_no_match += 1;
      continue;
    }
    result.matched += 1;
    if ((rule.trigger_spec as { swallow?: boolean } | null)?.swallow === true) {
      result.swallowed = true;
    }

    if (await isRateLimited(admin, userId)) {
      result.rate_limited += 1;
      console.warn(`[automation-engine] rate limit hit for user ${userId} on rule ${rule.id}`);
      continue;
    }

    const ctx = { ...payload, ...matchInfo.context };
    const runId = await createRun(admin, rule, ctx);
    if (!runId) continue;

    void runChain(admin, rule, runId, ctx).catch((e) => {
      console.error(`[automation-engine] chain failure ${runId}:`, e);
    });
    result.fired.push(runId);
  }

  return result;
}

// Per-trigger match logic. Returns { matched, context } where context augments
// the trigger payload (e.g. resolves a place_id to its label string).
async function matchTrigger(
  admin: SupabaseClient,
  rule: AutomationRow,
  payload: TriggerPayload,
): Promise<{ matched: boolean; context: Record<string, unknown> }> {
  const spec = rule.trigger_spec ?? {};
  const ctx: Record<string, unknown> = {};

  switch (rule.trigger_kind) {
    case "cron": {
      // Cron rules are matched by the cron worker itself (it knows when each
      // RRULE next fires). If we got here, it's already due — always match.
      return { matched: true, context: ctx };
    }

    case "location_arrived":
    case "location_left": {
      // Match if payload.place_id == spec.place_id, OR if payload's lat/lng
      // falls within saved place's radius. Plus optional time-of-day window.
      const targetPlaceId = spec.place_id as string | undefined;
      const payloadPlaceId = payload.place_id as string | undefined;

      if (targetPlaceId && payloadPlaceId && targetPlaceId === payloadPlaceId) {
        const place = await loadPlace(admin, targetPlaceId);
        if (place) {
          ctx.place = place.label;
          ctx.place_id = place.id;
        }
      } else if (targetPlaceId) {
        const place = await loadPlace(admin, targetPlaceId);
        if (!place || place.lat == null || place.lng == null) {
          return { matched: false, context: ctx };
        }
        const lat = Number(payload.lat);
        const lng = Number(payload.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return { matched: false, context: ctx };
        }
        const distance = haversineMeters(lat, lng, place.lat, place.lng);
        if (distance > (place.radius_m ?? 150)) {
          return { matched: false, context: ctx };
        }
        ctx.place = place.label;
        ctx.place_id = place.id;
      } else {
        // No specific place — match any movement. Rare but valid.
      }

      if (!withinTimeWindow(spec)) return { matched: false, context: ctx };
      return { matched: true, context: ctx };
    }

    case "email_received": {
      // Optional from / subject_contains filters on payload.
      const fromFilter = (spec.from as string | undefined)?.toLowerCase();
      const subjFilter = (spec.subject_contains as string | undefined)?.toLowerCase();
      const from = (payload.from as string | undefined)?.toLowerCase() ?? "";
      const subject = (payload.subject as string | undefined)?.toLowerCase() ?? "";
      if (fromFilter && !from.includes(fromFilter)) return { matched: false, context: ctx };
      if (subjFilter && !subject.includes(subjFilter)) return { matched: false, context: ctx };
      return { matched: true, context: ctx };
    }

    case "bank_txn": {
      // Filters: min_amount, max_amount, category, merchant_contains.
      const amount = Number(payload.amount);
      const min = spec.min_amount as number | undefined;
      const max = spec.max_amount as number | undefined;
      if (min != null && (!Number.isFinite(amount) || amount < min)) return { matched: false, context: ctx };
      if (max != null && (!Number.isFinite(amount) || amount > max)) return { matched: false, context: ctx };
      const cat = spec.category as string | undefined;
      if (cat && payload.category !== cat) return { matched: false, context: ctx };
      const merchant = (payload.merchant as string | undefined)?.toLowerCase() ?? "";
      const mFilter = (spec.merchant_contains as string | undefined)?.toLowerCase();
      if (mFilter && !merchant.includes(mFilter)) return { matched: false, context: ctx };
      return { matched: true, context: ctx };
    }

    case "payment_received": {
      const amount = Number(payload.amount);
      const min = spec.min_amount as number | undefined;
      if (min != null && (!Number.isFinite(amount) || amount < min)) return { matched: false, context: ctx };
      return { matched: true, context: ctx };
    }

    case "calendar_event": {
      // Match if payload.title contains spec.title_contains (if set). The cron
      // worker handles the "N min before" timing.
      const filter = (spec.title_contains as string | undefined)?.toLowerCase();
      const title = (payload.title as string | undefined)?.toLowerCase() ?? "";
      if (filter && !title.includes(filter)) return { matched: false, context: ctx };
      ctx.title = payload.title;
      ctx.when = payload.when;
      ctx.attendees = payload.attendees;
      return { matched: true, context: ctx };
    }

    case "periodic_check": {
      // The cron worker has already evaluated the natural-language check and
      // only dispatches the trigger when the check returned a match. The
      // payload carries the brain's answer and any extracted variables so the
      // action chain can reference {{answer}}, {{summary}}, or whatever the
      // check prompt surfaced.
      ctx.answer = payload.answer;
      ctx.summary = payload.summary;
      ctx.check_value = payload.check_value;
      return { matched: true, context: ctx };
    }

    case "inbound_message": {
      // Filters: has_media (bool), keyword_contains, from_contains, channel.
      const body = (payload.body as string | undefined) ?? "";
      const from = (payload.from as string | undefined) ?? "";
      const mediaUrls = (payload.media_urls as string[] | undefined) ?? [];
      const channel = payload.channel as string | undefined;

      const requireMedia = spec.has_media as boolean | undefined;
      if (requireMedia === true && mediaUrls.length === 0) {
        return { matched: false, context: ctx };
      }
      if (requireMedia === false && mediaUrls.length > 0) {
        return { matched: false, context: ctx };
      }
      const kw = (spec.keyword_contains as string | undefined)?.toLowerCase();
      if (kw && !body.toLowerCase().includes(kw)) {
        return { matched: false, context: ctx };
      }
      const fromFilter = (spec.from_contains as string | undefined)?.toLowerCase();
      if (fromFilter && !from.toLowerCase().includes(fromFilter)) {
        return { matched: false, context: ctx };
      }
      const channelFilter = spec.channel as string | undefined;
      if (channelFilter && channel !== channelFilter) {
        return { matched: false, context: ctx };
      }
      ctx.body = body;
      ctx.from = from;
      ctx.media_urls = mediaUrls;
      ctx.media_url = mediaUrls[0];
      ctx.channel = channel;
      return { matched: true, context: ctx };
    }
  }
}

async function loadPlace(
  admin: SupabaseClient,
  placeId: string,
): Promise<{ id: string; label: string; lat: number | null; lng: number | null; radius_m: number } | null> {
  const { data, error } = await admin
    .from("saved_places")
    .select("id, label, lat, lng, radius_m")
    .eq("id", placeId)
    .single();
  if (error || !data) return null;
  return data;
}

function withinTimeWindow(spec: Record<string, unknown>): boolean {
  const after = spec.after_local as string | undefined; // "23:00"
  const before = spec.before_local as string | undefined; // "06:00"
  if (!after && !before) return true;

  // Compare in user's local time. We don't carry user timezone on the rule yet,
  // so default to Europe/London (matches ops_agent default).
  const tz = (spec.tz as string | undefined) ?? "Europe/London";
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.format(new Date()).split(":").map(Number);
  const nowMin = (parts[0] ?? 0) * 60 + (parts[1] ?? 0);

  const toMin = (s?: string) => {
    if (!s) return null;
    const p = s.split(":").map(Number);
    return (p[0] ?? 0) * 60 + (p[1] ?? 0);
  };
  const a = toMin(after);
  const b = toMin(before);

  if (a != null && b != null) {
    // Window crosses midnight (e.g. 23:00 → 06:00) is the common case.
    return a <= b ? nowMin >= a && nowMin <= b : nowMin >= a || nowMin <= b;
  }
  if (a != null) return nowMin >= a;
  if (b != null) return nowMin <= b;
  return true;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function isRateLimited(admin: SupabaseClient, userId: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { count, error } = await admin
    .from("automation_runs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("started_at", since);
  if (error) {
    console.warn("[automation-engine] rate limit query failed:", error.message);
    return false;
  }
  return (count ?? 0) >= MAX_RUNS_PER_DAY;
}

// Manual test-fire: runs a specific automation once, bypassing trigger matching
// and rate limits. Used by the UI's "Test fire" button so the user can verify
// their rule works without waiting for the real trigger.
export async function fireAutomationDirect(
  admin: SupabaseClient,
  automationId: string,
  userId: string,
  payload: Record<string, unknown> = {},
): Promise<{ ok: boolean; run_id?: string; error?: string }> {
  const { data, error } = await admin
    .from("automations")
    .select("id, user_id, title, trigger_kind, trigger_spec, action_chain, ask_first, enabled, fire_count")
    .eq("id", automationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "not found" };

  const rule = data as AutomationRow;
  const ctx = { ...payload, _test_fire: true };
  const runId = await createRun(admin, rule, ctx);
  if (!runId) return { ok: false, error: "failed to create run" };

  void runChain(admin, rule, runId, ctx).catch((e) => {
    console.error(`[automation-engine] test-fire chain failure ${runId}:`, e);
  });

  return { ok: true, run_id: runId };
}

async function createRun(
  admin: SupabaseClient,
  rule: AutomationRow,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const { data, error } = await admin
    .from("automation_runs")
    .insert({
      automation_id: rule.id,
      user_id: rule.user_id,
      trigger_payload: payload,
      status: "queued",
      steps: [],
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[automation-engine] failed to create run:", error?.message);
    return null;
  }
  return data.id;
}

// Run the action chain. Updates automation_runs.steps after each step. If the
// rule has ask_first and the chain leads with a notify, we pause after that
// notify and wait for the user to reply (the WhatsApp inbound handler resumes).
async function runChain(
  admin: SupabaseClient,
  rule: AutomationRow,
  runId: string,
  triggerCtx: Record<string, unknown>,
): Promise<void> {
  await admin.from("automation_runs").update({ status: "running" }).eq("id", runId);

  const ctx = await buildToolContext(admin, rule.user_id);
  const stepLog: Array<Record<string, unknown>> = [];

  // ask_first prelude: send the user a WhatsApp confirm and pause. Only fires
  // if the chain has any step that costs money or messages a third party
  // (which we infer crudely as "more than just notify_user"). If the chain is
  // pure notify, ask_first is redundant — skip the pause.
  if (rule.ask_first && hasNonNotifySteps(rule.action_chain)) {
    const summary = chainSummary(rule, triggerCtx);
    await sendNotify(admin, rule.user_id, runId, summary);
    stepLog.push({ at: new Date().toISOString(), tool: "ask_first", summary });
    await admin
      .from("automation_runs")
      .update({ status: "awaiting_approval", steps: stepLog })
      .eq("id", runId);

    await admin
      .from("automations")
      .update({ last_fired_at: new Date().toISOString(), fire_count: rule.fire_count + 1 })
      .eq("id", rule.id);
    return;
  }

  for (const rawStep of rule.action_chain ?? []) {
    const step = substituteStep(rawStep, triggerCtx);
    const startedAt = new Date().toISOString();

    try {
      const out = await runStep(admin, rule.user_id, runId, step, ctx);
      stepLog.push({
        at: startedAt,
        tool: step.tool,
        args: step.args,
        result: truncate(out),
      });
      await admin.from("automation_runs").update({ steps: stepLog }).eq("id", runId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      stepLog.push({ at: startedAt, tool: step.tool, error: msg });
      await admin
        .from("automation_runs")
        .update({
          status: "failed",
          steps: stepLog,
          error: msg,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
      return;
    }
  }

  await admin
    .from("automation_runs")
    .update({
      status: "done",
      steps: stepLog,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);

  await admin
    .from("automations")
    .update({ last_fired_at: new Date().toISOString(), fire_count: rule.fire_count + 1 })
    .eq("id", rule.id);
}

// Resume a paused run after the user approves via WhatsApp. Called by the
// inbound WhatsApp handler when a reply arrives that quotes/refers to a
// pending automation_run.
export async function resumeRun(
  admin: SupabaseClient,
  runId: string,
  approved: boolean,
): Promise<void> {
  const { data: run, error } = await admin
    .from("automation_runs")
    .select("id, automation_id, user_id, trigger_payload, steps, status")
    .eq("id", runId)
    .single();
  if (error || !run) return;
  if (run.status !== "awaiting_approval") return;

  if (!approved) {
    await admin
      .from("automation_runs")
      .update({ status: "skipped", completed_at: new Date().toISOString() })
      .eq("id", runId);
    return;
  }

  const { data: rule } = await admin
    .from("automations")
    .select("id, user_id, title, trigger_kind, trigger_spec, action_chain, ask_first, enabled, fire_count")
    .eq("id", run.automation_id)
    .single();
  if (!rule) return;

  const ctx = await buildToolContext(admin, rule.user_id);
  const stepLog = (run.steps as Array<Record<string, unknown>>) ?? [];
  const triggerCtx = (run.trigger_payload as Record<string, unknown>) ?? {};

  await admin.from("automation_runs").update({ status: "running" }).eq("id", runId);

  for (const rawStep of (rule.action_chain as ActionStep[]) ?? []) {
    const step = substituteStep(rawStep, triggerCtx);
    const startedAt = new Date().toISOString();
    try {
      const out = await runStep(admin, rule.user_id, runId, step, ctx);
      stepLog.push({ at: startedAt, tool: step.tool, args: step.args, result: truncate(out) });
      await admin.from("automation_runs").update({ steps: stepLog }).eq("id", runId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      stepLog.push({ at: startedAt, tool: step.tool, error: msg });
      await admin
        .from("automation_runs")
        .update({ status: "failed", steps: stepLog, error: msg, completed_at: new Date().toISOString() })
        .eq("id", runId);
      return;
    }
  }

  await admin
    .from("automation_runs")
    .update({ status: "done", steps: stepLog, completed_at: new Date().toISOString() })
    .eq("id", runId);
}

async function runStep(
  admin: SupabaseClient,
  userId: string,
  runId: string,
  step: ActionStep,
  ctx: ToolContext,
): Promise<unknown> {
  // Engine-handled pseudo-tools first.
  if (step.tool === "send_whatsapp" || step.tool === "send_sms" || step.tool === "make_call") {
    const body = (step.args.body as string | undefined) ?? (step.args.message as string | undefined) ?? "";
    if (!body) throw new Error(`${step.tool}: missing body`);
    const channel: "whatsapp" | "sms" | "call" =
      step.tool === "send_whatsapp" ? "whatsapp" : step.tool === "send_sms" ? "sms" : "call";
    return await sendNotify(admin, userId, runId, body, channel);
  }

  // Otherwise, dispatch to a brain tool.
  const tool = TOOLS_BY_NAME[step.tool];
  if (!tool) throw new Error(`unknown tool '${step.tool}'`);
  return await tool.run(step.args, ctx);
}

async function sendNotify(
  admin: SupabaseClient,
  userId: string,
  runId: string,
  body: string,
  channel: "whatsapp" | "sms" | "call" = "whatsapp",
): Promise<unknown> {
  const { data: profile } = await admin
    .from("profiles")
    .select("mobile_e164")
    .eq("id", userId)
    .single();
  if (!profile?.mobile_e164) throw new Error("no mobile_e164 on profile");

  const { data: notif, error } = await admin
    .from("notifications")
    .insert({
      user_id: userId,
      channel,
      to_e164: profile.mobile_e164,
      body,
      status: "queued",
      automation_run_id: runId,
    })
    .select("id")
    .single();
  if (error || !notif) throw new Error(`notify insert: ${error?.message ?? "unknown"}`);

  await dispatchNotification(admin, notif.id);
  return { notification_id: notif.id, channel };
}

function chainSummary(rule: AutomationRow, ctx: Record<string, unknown>): string {
  // The summary is what the user sees on their phone before the chain runs.
  // We use the rule's title with {{vars}} substituted — short and readable.
  const title = substituteString(rule.title, ctx);
  return `${title}\n\nReply YES to go ahead, or ignore.`;
}

function hasNonNotifySteps(chain: ActionStep[]): boolean {
  return (chain ?? []).some((s) => !["send_whatsapp", "send_sms", "make_call", "notify_user"].includes(s.tool));
}

function substituteStep(step: ActionStep, ctx: Record<string, unknown>): ActionStep {
  return {
    tool: step.tool,
    args: substituteValue(step.args, ctx) as Record<string, unknown>,
  };
}

function substituteValue(value: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof value === "string") return substituteString(value, ctx);
  if (Array.isArray(value)) return value.map((v) => substituteValue(v, ctx));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substituteValue(v, ctx);
    }
    return out;
  }
  return value;
}

function substituteString(s: string, ctx: Record<string, unknown>): string {
  return s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    const v = ctx[key];
    return v == null ? "" : String(v);
  });
}

function truncate(v: unknown): unknown {
  if (typeof v === "string" && v.length > 600) return v.slice(0, 600) + "…";
  return v;
}

async function buildToolContext(admin: SupabaseClient, userId: string): Promise<ToolContext> {
  // Load the user's Google access token (best effort — most automation
  // chains won't need it, but inbox / calendar steps will).
  let googleAccessToken: string | undefined;
  try {
    const { data } = await admin
      .from("integrations")
      .select("credentials")
      .eq("user_id", userId)
      .eq("kind", "email")
      .eq("provider", "gmail")
      .eq("active", true)
      .maybeSingle();
    const tok = (data?.credentials as { access_token?: string } | undefined)?.access_token;
    if (tok) googleAccessToken = tok;
  } catch {
    /* no-op */
  }

  const embed = makeVoyageEmbed(process.env.VOYAGE_API_KEY ?? "");

  return {
    userId,
    supabase: admin,
    embed,
    ...(googleAccessToken ? { googleAccessToken } : {}),
    dispatchNotification: (id: string) => dispatchNotification(admin, id),
  };
}
