// Feature library — the app-store registry for JARVIS.
//
// Each feature has a stable id, a category, a user-facing name + description,
// what it requires to run (a connected integration, the desktop app, etc.),
// whether it's on by default, and a price tier.
//
// The brain reads this registry + user_features table to decide which tools
// to expose on each turn. Sensors + crons check the same source of truth.
//
// To add a new feature: append to FEATURES, pick a stable id, and — if it
// backs one or more brain tools — list them in `toolIds` so the tool list is
// filtered correctly for users who have it disabled.

export type FeatureCategory =
  | "agent"
  | "integration"
  | "sensor"
  | "skill"
  | "automation"
  | "scheduled";

export type FeatureTier = "free" | "pro" | "business";

export type FeatureRequirement =
  | "desktop" // requires the Tauri desktop app
  | "gmail"
  | "calendar"
  | "stripe"
  | "banking"
  | "home"
  | "twilio";

export interface Feature {
  id: string;
  category: FeatureCategory;
  name: string;
  tagline: string; // one-line blurb for the card
  description: string; // full description for the detail drawer
  icon: string; // emoji for now; swap to icon lib later
  requires: FeatureRequirement[];
  defaultEnabled: boolean;
  tier: FeatureTier;
  // Brain tool names backed by this feature. When the feature is disabled for
  // a user, these tools are filtered out of their turn. Leave empty for
  // features that don't map to tools (sensors, scheduled jobs, etc.).
  toolIds?: string[];
}

export const FEATURES: Feature[] = [
  // ── Agents ───────────────────────────────────────────────────────────────
  {
    id: "agent.inbox",
    category: "agent",
    name: "Inbox triage",
    tagline: "Classifies unread email and drafts replies",
    description:
      "Triages your inbox: reads unread threads, classifies urgency, drafts threaded replies that land in needs-approval so you can batch-approve in one tap.",
    icon: "📥",
    requires: ["gmail"],
    defaultEnabled: true,
    tier: "free",
    toolIds: ["inbox_agent"],
  },
  {
    id: "agent.writer",
    category: "agent",
    name: "Writer",
    tagline: "Drafts emails, LinkedIn, WhatsApp, tweets",
    description:
      "Drafts written content in your voice — emails, LinkedIn posts, WhatsApp replies, tweets, cold outreach. Always lands as a draft for you to approve.",
    icon: "✍️",
    requires: [],
    defaultEnabled: true,
    tier: "free",
    toolIds: ["writer_agent"],
  },
  {
    id: "agent.outreach",
    category: "agent",
    name: "Cold outreach",
    tagline: "Batch-personalised outreach, drafts only",
    description:
      "Generates N personalised cold emails from a prospect list, creates Gmail drafts you can review. Never auto-sends.",
    icon: "🎯",
    requires: ["gmail"],
    defaultEnabled: false,
    tier: "pro",
    toolIds: ["outreach_agent"],
  },
  {
    id: "agent.research",
    category: "agent",
    name: "Researcher",
    tagline: "Multi-source research reports",
    description:
      "Runs deep web research across multiple sources and returns a structured report. Good for competitor scans, market briefs, background on people.",
    icon: "🔎",
    requires: [],
    defaultEnabled: true,
    tier: "free",
    toolIds: ["research_agent"],
  },
  {
    id: "agent.code",
    category: "agent",
    name: "Code agent",
    tagline: "Delegates coding tasks to a background worker",
    description:
      "Queues code edits to a background worker with full coding tools. Watch progress in the Tasks panel.",
    icon: "⌨️",
    requires: [],
    defaultEnabled: true,
    tier: "pro",
    toolIds: ["code_agent"],
  },
  {
    id: "agent.ops",
    category: "agent",
    name: "Scheduler",
    tagline: "Reminders and scheduled delegations",
    description:
      "Schedules reminders and future tasks. Reminds you via WhatsApp at the right time, or runs a delegated job (like 'draft a follow-up Monday').",
    icon: "⏰",
    requires: [],
    defaultEnabled: true,
    tier: "free",
    toolIds: ["ops_agent"],
  },
  {
    id: "agent.concierge",
    category: "agent",
    name: "Concierge",
    tagline: "Web lookups, bookings, comparisons",
    description:
      "Runs headless-browser errands server-side: finds restaurants, compares flights, checks product stock, digs up opening hours. Stops at checkout.",
    icon: "🎩",
    requires: [],
    defaultEnabled: true,
    tier: "free",
    toolIds: ["concierge_task"],
  },
  {
    id: "agent.recall",
    category: "agent",
    name: "Total Recall",
    tagline: "Search everything you've ever seen, said, or written",
    description:
      "A unified, searchable archive of your emails, calendar events, and chats — all semantically indexed. Ask 'what did Tom say about pricing?', 'when did I last speak to Sarah?', or 'find that restaurant Anna recommended'. Works across every source JARVIS can see.",
    icon: "🧠",
    requires: ["gmail"],
    defaultEnabled: false,
    tier: "pro",
    toolIds: ["recall"],
  },
  {
    id: "agent.meeting_ghost",
    category: "agent",
    name: "Meeting Ghost",
    tagline: "Toggle on and JARVIS transcribes, summarises, and files meetings",
    description:
      "Tap Start on the Meetings page and JARVIS listens to your mic — any conversation, any app, any platform. When you stop, it writes a title, summary, and action items and files everything into Total Recall so you can search it like any other memory.",
    icon: "🎤",
    requires: [],
    defaultEnabled: false,
    tier: "pro",
    toolIds: ["list_meetings"],
  },
  {
    id: "agent.earpiece_coach",
    category: "agent",
    name: "Earpiece Coach",
    tagline: "Silent whispers during live meetings — facts, names, numbers",
    description:
      "During an active Meeting Ghost recording, a background coach loop watches the live transcript and whispers one-liners on the side when a fact from your history would help: 'Tom asked about pricing — you quoted £49 two weeks ago', 'Anna's restaurant was Lisboeta'. Silent text, no live TTS (no feedback-loop risk).",
    icon: "🎧",
    requires: [],
    defaultEnabled: false,
    tier: "pro",
  },
  {
    id: "agent.errand",
    category: "agent",
    name: "Errand agent",
    tagline: "Multi-day autonomous goals",
    description:
      "Drives multi-day objectives to completion (cheaper car insurance, replacement for a broken thing, dispute resolution). Acts autonomously under £100; WhatsApps for bigger decisions.",
    icon: "🎪",
    requires: [],
    defaultEnabled: false,
    tier: "pro",
    toolIds: ["start_errand", "list_errands", "errand_respond"],
  },

  // ── Integrations ─────────────────────────────────────────────────────────
  {
    id: "integration.gmail",
    category: "integration",
    name: "Gmail",
    tagline: "Read, draft, and organise email",
    description:
      "Connects your Gmail so JARVIS can read, search, label, and draft emails. Never sends without your approval.",
    icon: "✉️",
    requires: [],
    defaultEnabled: true,
    tier: "free",
    toolIds: ["list_emails", "read_email", "draft_email"],
  },
  {
    id: "integration.calendar",
    category: "integration",
    name: "Calendar",
    tagline: "Read and create calendar events",
    description:
      "Google Calendar access so JARVIS can list events, find free slots, and create meetings on your behalf.",
    icon: "📅",
    requires: [],
    defaultEnabled: true,
    tier: "free",
    toolIds: ["list_calendar_events", "create_calendar_event"],
  },
  {
    id: "integration.stripe",
    category: "integration",
    name: "Stripe",
    tagline: "Revenue, customers, charges, subscriptions",
    description:
      "Read-only Stripe access. Ask 'how much did we make this week?', 'who signed up?', 'any failed charges?', 'what's MRR?'",
    icon: "💳",
    requires: [],
    defaultEnabled: false,
    tier: "free",
    toolIds: [
      "payments_revenue",
      "payments_customers",
      "payments_charges",
      "payments_subscriptions",
    ],
  },
  {
    id: "integration.banking",
    category: "integration",
    name: "Banking",
    tagline: "Personal finance — balances, spending, transactions",
    description:
      "Read-only Monzo/TrueLayer access. 'How much did I spend on food?', 'what's in my savings pot?', 'spending breakdown this month?'",
    icon: "🏦",
    requires: ["banking"],
    defaultEnabled: false,
    tier: "free",
    toolIds: ["banking_accounts", "banking_transactions", "banking_spending"],
  },
  {
    id: "integration.home",
    category: "integration",
    name: "Smart home",
    tagline: "Control TVs, lights, plugs, speakers",
    description:
      "SmartThings integration — control the TV, lights, plugs, and other smart devices by voice or chat.",
    icon: "🏠",
    requires: ["home"],
    defaultEnabled: false,
    tier: "free",
    toolIds: ["home_list_devices", "home_control_device"],
  },
  {
    id: "integration.spotify",
    category: "integration",
    name: "Music control",
    tagline: "Spotify + Apple Music playback",
    description:
      "Control Spotify and Apple Music playback from chat or voice — play, pause, skip, queue, playlist.",
    icon: "🎵",
    requires: ["desktop"],
    defaultEnabled: true,
    tier: "free",
    toolIds: [
      "play_spotify",
      "control_spotify",
      "music_play",
      "music_control",
    ],
  },

  // ── Sensors (desktop) ────────────────────────────────────────────────────
  {
    id: "sensor.face_gate",
    category: "sensor",
    name: "Face gate",
    tagline: "Only respond when the camera sees you",
    description:
      "Verifies your face at the webcam before sending messages. Useful if someone else could grab your laptop — JARVIS won't act for strangers.",
    icon: "🛡️",
    requires: ["desktop"],
    defaultEnabled: false,
    tier: "pro",
  },
  {
    id: "sensor.focus",
    category: "sensor",
    name: "Focus pause",
    tagline: "Pauses media when you turn away",
    description:
      "Pauses music/video when another face or voice enters AND you turn your head away. Resumes when you look back.",
    icon: "🎧",
    requires: ["desktop"],
    defaultEnabled: false,
    tier: "free",
  },
  {
    id: "sensor.gesture",
    category: "sensor",
    name: "Thumbs-up approve",
    tagline: "Approve pending tasks with a gesture",
    description:
      "Hold a thumbs-up to the webcam (~1 sec) to approve the most recent pending task — e.g. a £150 errand charge.",
    icon: "👍",
    requires: ["desktop"],
    defaultEnabled: false,
    tier: "free",
  },
  {
    id: "sensor.swipe",
    category: "sensor",
    name: "Swipe to close tab",
    tagline: "Hand sweep closes the current browser tab",
    description:
      "Quick horizontal hand sweep in front of the webcam closes the current browser tab (⌘W). Only fires when a browser is frontmost.",
    icon: "👋",
    requires: ["desktop"],
    defaultEnabled: false,
    tier: "free",
  },
  {
    id: "sensor.gaze",
    category: "sensor",
    name: "Head-tilt scroll",
    tagline: "Tilt your head to scroll the page",
    description:
      "Tilt your head up or down to smoothly scroll the current page — small tilt scrolls slow, bigger tilt scrolls fast.",
    icon: "🙇",
    requires: ["desktop"],
    defaultEnabled: false,
    tier: "free",
  },
  {
    id: "sensor.screen",
    category: "sensor",
    name: "Ambient screen context",
    tagline: "OCRs the frontmost window so JARVIS always knows what you're looking at",
    description:
      "Silently OCRs the frontmost window every ~15s so JARVIS can answer 'what's this email about?' or 'reply to this' without you copying anything. On-device, private, free.",
    icon: "👁️",
    requires: ["desktop"],
    defaultEnabled: false,
    tier: "free",
  },

  // ── Skills ───────────────────────────────────────────────────────────────
  {
    id: "skill.engine",
    category: "skill",
    name: "Skill library",
    tagline: "Install purpose-built skills on demand",
    description:
      "When a task matches a specialised skill (QR codes, PDF OCR, invoices, niche tools) JARVIS can find, preview, install, and run it. Every install needs your approval.",
    icon: "🧩",
    requires: [],
    defaultEnabled: true,
    tier: "free",
    toolIds: [
      "find_skill",
      "install_skill",
      "load_skill",
      "exec_skill_script",
    ],
  },

  // ── Automations ──────────────────────────────────────────────────────────
  {
    id: "automation.engine",
    category: "automation",
    name: "Automations",
    tagline: "Rules that fire on triggers (time, place, email, payment)",
    description:
      "Let JARVIS learn recurring rules from real moments: 'every time I'm at Anna's after 11pm, order me an Uber home', 'every Monday 9am, give me the weekend recap'.",
    icon: "⚡",
    requires: [],
    defaultEnabled: true,
    tier: "pro",
    toolIds: [
      "create_automation",
      "list_automations",
      "toggle_automation",
      "add_saved_place",
      "add_saved_person",
    ],
  },

  // ── Scheduled ────────────────────────────────────────────────────────────
  {
    id: "scheduled.morning_briefing",
    category: "scheduled",
    name: "Morning briefing",
    tagline: "WhatsApp digest every day at 07:00",
    description:
      "Daily 07:00 WhatsApp briefing: revenue, spending, calendar, emails needing reply, birthdays, weather. Requires WhatsApp number on your profile.",
    icon: "🌅",
    requires: ["twilio"],
    defaultEnabled: false,
    tier: "free",
  },
  {
    id: "scheduled.recall_sync",
    category: "scheduled",
    name: "Total Recall sync",
    tagline: "Auto-indexes new emails, events, and chats",
    description:
      "Runs every ~30 min to pull new Gmail messages, calendar events, and chat turns into the Total Recall index. Required for live search to stay fresh without hitting Re-index by hand.",
    icon: "🔄",
    requires: ["gmail"],
    defaultEnabled: false,
    tier: "pro",
  },
];

export const FEATURES_BY_ID: Record<string, Feature> = Object.fromEntries(
  FEATURES.map((f) => [f.id, f]),
);

// Reverse map: tool name → feature id. Used when filtering brain tools based
// on user-enabled features. Tools not listed in any feature are always on.
export const TOOL_TO_FEATURE: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const f of FEATURES) {
    for (const t of f.toolIds ?? []) m[t] = f.id;
  }
  return m;
})();

export function isFeatureEnabled(
  featureId: string,
  userEnabled: Set<string>,
  userDisabled: Set<string>,
): boolean {
  const f = FEATURES_BY_ID[featureId];
  if (!f) return false;
  if (userDisabled.has(featureId)) return false;
  if (userEnabled.has(featureId)) return true;
  return f.defaultEnabled;
}
