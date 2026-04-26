// One-click preset creator for the /watchers page. The UI posts a preset id
// (wake_up_call, evening_wrap, meeting_intel, price_watch, photo_inbox,
// group_chat_mode) plus a handful of fields, and we materialise a full
// automation row: title + trigger_kind + trigger_spec + action_chain.
//
// Keeping the templates server-side means we can evolve the action chains
// (e.g. upgrade meeting_intel to run a deeper agent) without shipping a new
// client. The brain's create_automation tool remains the flexible path; this
// endpoint is the fast path for the six named features.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type PresetId =
  | "wake_up_call"
  | "evening_wrap"
  | "meeting_intel"
  | "price_watch"
  | "photo_inbox"
  | "group_chat_mode";

type PresetArgs = {
  preset: PresetId;
  // Free-form fields the preset needs — we validate per preset below.
  time_local?: string;         // "07:30"
  rrule?: string;              // "FREQ=DAILY;BYHOUR=7;BYMINUTE=30"
  call_script?: string;        // wake-up call prompt
  watch_what?: string;         // natural-language watch ("Tokyo BA flight under £400")
  interval_minutes?: number;   // periodic_check cadence
  minutes_before?: number;     // meeting_intel lead time
  title_contains?: string;     // meeting_intel filter
  keyword_contains?: string;   // inbound_message filter
  from_contains?: string;      // inbound_message filter (group chat)
};

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: PresetArgs;
  try {
    body = (await req.json()) as PresetArgs;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const row = buildPreset(body);
  if (!row) return NextResponse.json({ ok: false, error: "unknown preset" }, { status: 400 });

  const { data, error } = await supabase
    .from("automations")
    .insert({ ...row, user_id: user.id })
    .select("id, title")
    .single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, automation_id: data.id, title: data.title });
}

type BuiltRow = {
  title: string;
  description: string;
  trigger_kind: string;
  trigger_spec: Record<string, unknown>;
  action_chain: Array<{ tool: string; args: Record<string, unknown> }>;
  ask_first: boolean;
  enabled: boolean;
};

function buildPreset(b: PresetArgs): BuiltRow | null {
  switch (b.preset) {
    case "wake_up_call": {
      const rrule = b.rrule ?? defaultDailyRrule(b.time_local ?? "07:30");
      const script =
        b.call_script?.trim() ||
        "Good morning — this is JARVIS. Time to get up. I'll text over your schedule in a minute.";
      return {
        title: "Wake-up call",
        description: `Call me every day at ${b.time_local ?? "07:30"} and read the script.`,
        trigger_kind: "cron",
        trigger_spec: { rrule },
        action_chain: [{ tool: "make_call", args: { body: script } }],
        ask_first: false,
        enabled: true,
      };
    }

    case "evening_wrap": {
      const rrule = b.rrule ?? defaultDailyRrule(b.time_local ?? "21:30");
      return {
        title: "Evening wrap",
        description: "Daily WhatsApp digest of what happened + what's coming tomorrow.",
        trigger_kind: "cron",
        trigger_spec: { rrule },
        action_chain: [
          {
            tool: "concierge_agent",
            args: {
              goal:
                "Summarise today for the user: completed tasks, finished automations, inbound WhatsApps/SMS, unread important emails, calendar for tomorrow. Keep it under 120 words. Send via WhatsApp.",
            },
          },
        ],
        ask_first: false,
        enabled: true,
      };
    }

    case "meeting_intel": {
      const minutes_before = clampInt(b.minutes_before, 1, 120, 10);
      const filter = b.title_contains?.trim();
      return {
        title: filter ? `Meeting intel · ${filter}` : "Meeting intel",
        description:
          "Before every calendar event, send a WhatsApp brief on attendees, prior threads, and likely talking points.",
        trigger_kind: "calendar_event",
        trigger_spec: {
          minutes_before,
          ...(filter ? { title_contains: filter } : {}),
        },
        action_chain: [
          {
            tool: "concierge_agent",
            args: {
              goal:
                "Prep the user for their upcoming meeting \"{{title}}\" at {{when}} with {{attendees}}. Pull recent emails/messages with attendees, summarise context, and list 3 likely talking points. Send via WhatsApp — short, skimmable.",
            },
          },
        ],
        ask_first: false,
        enabled: true,
      };
    }

    case "price_watch": {
      const watch = b.watch_what?.trim();
      if (!watch) return null;
      const interval = clampInt(b.interval_minutes, 15, 24 * 60, 60);
      return {
        title: `Watch: ${watch}`,
        description: `Check every ${interval} min — message me when it matches.`,
        trigger_kind: "periodic_check",
        trigger_spec: {
          check_prompt: watch,
          interval_minutes: interval,
          fire_on: "change",
        },
        action_chain: [
          {
            tool: "send_whatsapp",
            args: { body: "Heads up — {{summary}}" },
          },
        ],
        ask_first: false,
        enabled: true,
      };
    }

    case "photo_inbox": {
      return {
        title: "Photo inbox",
        description:
          "Any WhatsApp photo I forward gets filed: receipts extracted, IDs stored, contacts captured.",
        trigger_kind: "inbound_message",
        trigger_spec: { has_media: true, channel: "whatsapp", swallow: true },
        action_chain: [
          {
            tool: "concierge_agent",
            args: {
              goal:
                "The user forwarded an image. Fetch {{media_url}}, figure out what it is (receipt, document, business card, etc), extract the key fields, file/tag it appropriately, and send a one-line WhatsApp confirmation.",
            },
          },
        ],
        ask_first: false,
        enabled: true,
      };
    }

    case "group_chat_mode": {
      const from = b.from_contains?.trim();
      const keyword = b.keyword_contains?.trim() || "jarvis";
      return {
        title: from ? `Group chat · ${from}` : "Group chat mode",
        description:
          "When someone mentions JARVIS in the group chat, drive the task silently.",
        trigger_kind: "inbound_message",
        trigger_spec: {
          channel: "whatsapp",
          keyword_contains: keyword,
          ...(from ? { from_contains: from } : {}),
          swallow: true,
        },
        action_chain: [
          {
            tool: "concierge_agent",
            args: {
              goal:
                "A group-chat member said: \"{{body}}\" (from {{from}}). If it's an instruction for JARVIS, carry it out end-to-end. If it's context only, take no action. Reply in the group chat ({{channel}}) with the result, briefly.",
            },
          },
        ],
        ask_first: false,
        enabled: true,
      };
    }

    default:
      return null;
  }
}

function defaultDailyRrule(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((v) => Number(v));
  const hh = Number.isFinite(h) ? h : 7;
  const mm = Number.isFinite(m) ? m : 30;
  return `FREQ=DAILY;BYHOUR=${hh};BYMINUTE=${mm}`;
}

function clampInt(v: number | undefined, min: number, max: number, dflt: number): number {
  if (v == null || !Number.isFinite(v)) return dflt;
  return Math.min(max, Math.max(min, Math.round(v)));
}
