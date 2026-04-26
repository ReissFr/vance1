// Cron worker for periodic_check + calendar_event triggers. Runs every minute
// alongside run-automations (which handles the cron kind). Kept separate so
// cron-triggered rules stay cheap (no LLM calls) while watchers can be heavier.
//
// periodic_check:
//   For each enabled periodic_check rule whose last_checked_at is older than
//   interval_minutes (default 30), we call Haiku with the user's check_prompt
//   and expect a strict JSON answer { matched, summary?, value? }. When
//   matched=true we dispatch the trigger. State tracks the previous match so
//   fire_on="change" watchers only fire when the boolean flipped.
//
// calendar_event:
//   For each user with enabled calendar_event rules, fetch upcoming Google
//   Calendar events in the next 2h. For each event within a rule's minutes_
//   before window, check the rule's state.fired_event_ids and dispatch if
//   not already fired for that event. Stores event_id in state to dedupe.

import { type NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchTrigger } from "@/lib/automation-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_SIZE = 40;
const CHECK_INTERVAL_DEFAULT = 30; // minutes
const CALENDAR_LOOKAHEAD_MS = 2 * 60 * 60 * 1000; // 2h

type PeriodicCheckSpec = {
  check_prompt?: string;
  interval_minutes?: number;
  // "always" (default) fires whenever matched=true; "change" only fires when
  // the match flips from false→true so "is X in stock?" doesn't spam daily.
  fire_on?: "always" | "change";
};

type CalendarEventSpec = {
  title_contains?: string;
  minutes_before?: number;
};

type RuleRow = {
  id: string;
  user_id: string;
  trigger_kind: string;
  trigger_spec: Record<string, unknown>;
  last_checked_at: string | null;
  state: Record<string, unknown>;
};

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("x-cron-secret") === secret;
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return handle();
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return handle();
}

async function handle() {
  const admin = supabaseAdmin();
  const now = new Date();

  const { data: rules, error } = await admin
    .from("automations")
    .select("id, user_id, trigger_kind, trigger_spec, last_checked_at, state")
    .in("trigger_kind", ["periodic_check", "calendar_event"])
    .eq("enabled", true)
    .limit(BATCH_SIZE);

  if (error) {
    console.error("[cron/run-watchers] query failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let checked = 0;
  let fired = 0;
  const firedIds: string[] = [];

  for (const rule of (rules ?? []) as RuleRow[]) {
    try {
      if (rule.trigger_kind === "periodic_check") {
        const did = await runPeriodicCheck(admin, rule, now);
        checked += 1;
        if (did) {
          fired += 1;
          firedIds.push(rule.id);
        }
      } else if (rule.trigger_kind === "calendar_event") {
        const count = await runCalendarEventScan(admin, rule, now);
        checked += 1;
        fired += count;
        if (count > 0) firedIds.push(rule.id);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[cron/run-watchers] rule ${rule.id} failed:`, msg);
    }
  }

  return NextResponse.json({ ok: true, now: now.toISOString(), checked, fired, firedIds });
}

async function runPeriodicCheck(
  admin: ReturnType<typeof supabaseAdmin>,
  rule: RuleRow,
  now: Date,
): Promise<boolean> {
  const spec = rule.trigger_spec as PeriodicCheckSpec;
  const interval = spec.interval_minutes ?? CHECK_INTERVAL_DEFAULT;
  const lastAt = rule.last_checked_at ? new Date(rule.last_checked_at).getTime() : 0;
  if (now.getTime() - lastAt < interval * 60_000) return false;

  const prompt = spec.check_prompt?.trim();
  if (!prompt) {
    await admin
      .from("automations")
      .update({ last_checked_at: now.toISOString() })
      .eq("id", rule.id);
    return false;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[cron/run-watchers] ANTHROPIC_API_KEY not set — skipping check");
    return false;
  }

  const anthropic = new Anthropic({ apiKey });
  let matched = false;
  let summary: string | undefined;
  let value: unknown;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system:
        "You evaluate a watcher condition. Respond with a SINGLE JSON object and nothing else, " +
        "shape: { \"matched\": boolean, \"summary\": string, \"value\": string | number | null }. " +
        "Set matched=true if the condition is currently satisfied. Keep summary under 160 chars.",
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const parsed = extractJson(text);
    if (parsed && typeof parsed.matched === "boolean") {
      matched = parsed.matched;
      summary = typeof parsed.summary === "string" ? parsed.summary : undefined;
      value = parsed.value;
    }
  } catch (e) {
    console.error(`[cron/run-watchers] check eval failed for ${rule.id}:`, e);
    return false;
  }

  const prevMatched = Boolean((rule.state as { last_matched?: boolean }).last_matched);
  const fireOn = spec.fire_on ?? "always";
  const shouldFire = matched && (fireOn === "always" || !prevMatched);

  await admin
    .from("automations")
    .update({
      last_checked_at: now.toISOString(),
      state: { ...(rule.state ?? {}), last_matched: matched, last_summary: summary },
    })
    .eq("id", rule.id);

  if (!shouldFire) return false;

  await dispatchTrigger(admin, "periodic_check", rule.user_id, {
    rule_id: rule.id,
    answer: summary ?? "",
    summary: summary ?? "",
    check_value: value ?? null,
  });
  return true;
}

async function runCalendarEventScan(
  admin: ReturnType<typeof supabaseAdmin>,
  rule: RuleRow,
  now: Date,
): Promise<number> {
  const spec = rule.trigger_spec as CalendarEventSpec;
  const minutesBefore = spec.minutes_before ?? 10;
  const filter = spec.title_contains?.toLowerCase();

  const { data: profile } = await admin
    .from("profiles")
    .select("google_access_token")
    .eq("id", rule.user_id)
    .single();
  const token = profile?.google_access_token as string | undefined;
  if (!token) {
    await admin.from("automations").update({ last_checked_at: now.toISOString() }).eq("id", rule.id);
    return 0;
  }

  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + CALENDAR_LOOKAHEAD_MS).toISOString();
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "25");

  let events: Array<{ id: string; summary?: string; start?: { dateTime?: string; date?: string }; attendees?: Array<{ email?: string; displayName?: string }> }> = [];
  try {
    const res = await fetch(url.toString(), { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      await admin.from("automations").update({ last_checked_at: now.toISOString() }).eq("id", rule.id);
      return 0;
    }
    const body = (await res.json()) as { items?: typeof events };
    events = body.items ?? [];
  } catch {
    return 0;
  }

  const firedIds = new Set<string>((rule.state as { fired_event_ids?: string[] }).fired_event_ids ?? []);
  let firedCount = 0;

  for (const event of events) {
    if (!event.id) continue;
    if (firedIds.has(event.id)) continue;
    const title = event.summary ?? "";
    if (filter && !title.toLowerCase().includes(filter)) continue;

    const startStr = event.start?.dateTime ?? event.start?.date;
    if (!startStr) continue;
    const startMs = new Date(startStr).getTime();
    const leadMs = startMs - now.getTime();
    // Fire if we're within [minutes_before, minutes_before + 5min) of start.
    // The +5min window lets us still fire even if the cron skipped a tick.
    if (leadMs > minutesBefore * 60_000) continue;
    if (leadMs < (minutesBefore - 5) * 60_000) continue;

    await dispatchTrigger(admin, "calendar_event", rule.user_id, {
      event_id: event.id,
      title,
      when: startStr,
      attendees: (event.attendees ?? []).map((a) => a.email ?? a.displayName).filter(Boolean),
    });
    firedIds.add(event.id);
    firedCount += 1;
  }

  // Keep the fired_event_ids list bounded — only retain events from the last
  // 24h so the state doesn't grow forever.
  const cutoff = now.getTime() - 24 * 60 * 60_000;
  const pruned: string[] = [];
  for (const id of firedIds) {
    // Without knowing the event start time, we can't prune precisely; trim
    // to the 200 most recent (Set insertion order).
    pruned.push(id);
  }
  void cutoff;
  const trimmed = pruned.slice(-200);

  await admin
    .from("automations")
    .update({
      last_checked_at: now.toISOString(),
      state: { ...(rule.state ?? {}), fired_event_ids: trimmed },
    })
    .eq("id", rule.id);

  return firedCount;
}

function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Allow the model to wrap the JSON in backticks or prose.
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
