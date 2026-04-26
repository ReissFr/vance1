// Dynamic tool pruning. The tools block is ~50 entries, hundreds of lines
// of JSON schema. On an uncached request it costs 2–5k input tokens. Most
// user messages only need a small slice (e.g. "what's the weather?" needs
// one tool). This module classifies the message into a set of categories
// and returns the subset of tools worth shipping.
//
// Trade-off vs. prompt caching: pruning changes the tools block, which
// busts the ephemeral cache on that breakpoint. We only prune when we have
// HIGH confidence that a narrow subset suffices — otherwise we return the
// full list so the cache stays warm across turns.
import type { ToolDef } from "../tools";

export type ToolCategory =
  | "browser"
  | "email"
  | "calendar"
  | "payments"
  | "commerce"
  | "accounting"
  | "banking"
  | "crypto"
  | "home"
  | "info"
  | "skills"
  | "agents"
  | "errands"
  | "automations"
  | "mac_device"
  | "mac_apps"
  | "code";

// Tools we always ship regardless of classification — cheap, broadly useful,
// and/or the brain's escape hatches when nothing else fits.
const ALWAYS_ON = new Set<string>([
  "save_memory",
  "recall_memory",
  "recall",
  "notify_user",
  "find_skill",
  "concierge_agent",
  "start_errand",
  "list_errands",
  "errand_respond",
]);

// Map tool name → one or more categories. Any tool not in this map is
// treated as ALWAYS_ON.
const TOOL_CATEGORIES: Record<string, ToolCategory[]> = {
  // browser
  browser_open: ["browser"],
  browser_screenshot: ["browser"],
  browser_read: ["browser"],
  browser_click: ["browser"],
  browser_type: ["browser"],
  browser_press: ["browser"],
  browser_scroll: ["browser"],
  browser_back: ["browser"],
  browser_wait: ["browser"],
  // email
  list_emails: ["email"],
  read_email: ["email"],
  draft_email: ["email"],
  inbox_agent: ["email", "agents"],
  outreach_agent: ["email", "agents"],
  writer_agent: ["agents"],
  // calendar
  list_meetings: ["calendar"],
  list_calendar: ["calendar"],
  create_calendar: ["calendar"],
  // payments
  payments_revenue: ["payments"],
  payments_customers: ["payments"],
  payments_charges: ["payments"],
  payments_subscriptions: ["payments"],
  // commerce (online store)
  commerce_orders: ["commerce"],
  commerce_products: ["commerce"],
  commerce_low_stock: ["commerce"],
  commerce_sales: ["commerce", "payments"],
  // accounting (bookkeeping)
  accounting_invoices: ["accounting"],
  accounting_expenses: ["accounting"],
  accounting_balances: ["accounting", "banking"],
  accounting_contacts: ["accounting"],
  // banking
  banking_accounts: ["banking"],
  banking_transactions: ["banking"],
  banking_spending: ["banking"],
  // crypto
  crypto_wallets: ["crypto"],
  crypto_portfolio: ["crypto"],
  crypto_transactions: ["crypto"],
  crypto_save_address: ["crypto"],
  crypto_list_addresses: ["crypto"],
  crypto_send: ["crypto"],
  list_pending_crypto_actions: ["crypto"],
  crypto_action_respond: ["crypto"],
  // home
  home_list_devices: ["home"],
  home_control_device: ["home"],
  // info
  weather: ["info"],
  hackernews_top: ["info"],
  news_headlines: ["info"],
  github_notifications: ["info"],
  // skills
  load_skill: ["skills"],
  install_skill: ["skills"],
  exec_skill_script: ["skills"],
  // agents
  research_agent: ["agents"],
  ops_agent: ["agents"],
  // automations
  create_automation: ["automations"],
  list_automations: ["automations"],
  toggle_automation: ["automations"],
  add_saved_place: ["automations"],
  add_saved_person: ["automations"],
  // mac device control
  open_url: ["mac_device"],
  launch_app: ["mac_device"],
  run_shortcut: ["mac_device"],
  play_spotify: ["mac_device"],
  control_spotify: ["mac_device"],
  applescript: ["mac_device"],
  type_text: ["mac_device"],
  press_keys: ["mac_device"],
  read_app_text: ["mac_device"],
  // mac apps
  imessage_read: ["mac_apps"],
  imessage_send: ["mac_apps"],
  contacts_lookup: ["mac_apps"],
  notes_read: ["mac_apps"],
  notes_create: ["mac_apps"],
  music_play: ["mac_apps"],
  music_control: ["mac_apps"],
  obsidian_search: ["mac_apps"],
  // code
  code_agent: ["code"],
};

interface CategoryRule {
  category: ToolCategory;
  patterns: RegExp[];
}

// Keyword triggers per category. Tuned to be high-precision — we'd rather
// miss a category and ship the full tool list than strip a tool the brain
// actually needs mid-task.
const RULES: CategoryRule[] = [
  {
    category: "browser",
    patterns: [
      /\b(go to|navigate to|open (?:safari|chrome|google)|click on|scroll|fill in|fill out|submit|search for|look up|buy|order|purchase|checkout|add to cart|book (?:a|me)|reserve|bet|trade|long|short|sign in to|log in to|subscribe|register|on the screen|what'?s on screen|what do you see)\b/,
      /\b(polymarket|instagram|youtube|twitter|reddit|amazon|tiktok|facebook|ebay|google|linkedin|stripe\.com|paypal)\b/,
      /\bhttps?:\/\/\S+/,
    ],
  },
  {
    category: "email",
    patterns: [
      /\b(email|emails|inbox|gmail|reply(?:ing)? to|forward(?:ing)?|draft(?:ing)?|compose|unread|send to|mail)\b/,
      /\bmessage .*@/,
      /\b(cold outreach|cold email|outreach campaign)\b/,
    ],
  },
  {
    category: "calendar",
    patterns: [
      /\b(calendar|meeting|meetings|event|events|schedule(?:d)?|appointment|booking|book me|my day|my week|upcoming)\b/,
    ],
  },
  {
    category: "payments",
    patterns: [
      /\b(revenue|stripe|paypal|square|customer(?:s)?|charges?|subscription(?:s)?|income|mrr|arr|payout(?:s)?)\b/,
    ],
  },
  {
    category: "commerce",
    patterns: [
      /\b(shopify|store|shop|order(?:s)?|product(?:s)?|catalog|inventory|stock|low stock|sku(?:s)?|fulfil(?:l)?(?:ed|ment)?|refund(?:ed)?|cart|checkout|the shop did|store sales)\b/,
    ],
  },
  {
    category: "accounting",
    patterns: [
      /\b(xero|quickbooks|quick\s?books|freeagent|free\s?agent|invoice(?:s)?|bill(?:s)?|expense(?:s)?|bookkeeping|accountant|supplier(?:s)?|overdue|receipt(?:s)?|p&l|profit and loss|cash position|chart of accounts)\b/,
    ],
  },
  {
    category: "banking",
    patterns: [
      /\b(bank|balance(?:s)?|account(?:s)? balance|transaction(?:s)?|spent|spending|budget)\b/,
    ],
  },
  {
    category: "crypto",
    patterns: [
      /\b(crypto|coinbase|kraken|bitcoin|btc|ethereum|eth|usdc|usdt|solana|sol|wallet(?:s)?|portfolio|staking|whitelist|withdraw(?:al)?|send\s+(?:\d|btc|eth|usdc|usdt|sol|crypto)|on-chain)\b/i,
    ],
  },
  {
    category: "home",
    patterns: [
      /\b(lights?|lamp(?:s)?|thermostat|tv|television|plug|smart\s?home|smartthings|heating|aircon|ac\b|switch (?:on|off) the|turn (?:on|off) the)\b/,
    ],
  },
  {
    category: "info",
    patterns: [
      /\b(weather|forecast|temperature|rain|snow|news|headlines|hacker\s?news|hn top|github notifications)\b/,
    ],
  },
  {
    category: "skills",
    patterns: [
      /\b(skill|skills|install skill|find a skill|run skill)\b/,
    ],
  },
  {
    category: "agents",
    patterns: [
      /\b(research|find info on|investigate|dig into|write me|draft(?:ing)? (?:a|an|some)|reminder|remind me|schedule (?:a|an) reminder)\b/,
    ],
  },
  {
    category: "errands",
    patterns: [
      /\berrand(?:s)?\b/,
    ],
  },
  {
    category: "automations",
    patterns: [
      /\b(automation|automate|recurring|every (?:morning|evening|day|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily at|weekly at|when .* happens|trigger when)\b/,
    ],
  },
  {
    category: "mac_device",
    patterns: [
      /\b(open safari|open chrome|launch (?:app|application)|shortcut|spotify|play|pause|volume|mute|type this|press (?:cmd|ctrl|option|shift))\b/,
    ],
  },
  {
    category: "mac_apps",
    patterns: [
      /\b(imessage|message (?:mum|dad|my|to)|text (?:mum|dad|my|to)|contact(?:s)?|apple notes|my notes|music app|obsidian)\b/,
    ],
  },
  {
    category: "code",
    patterns: [
      /\b(code_agent|refactor|fix (?:the )?(?:bug|code)|implement (?:a|the)|write (?:a )?function|commit|pull request|repo|codebase)\b/,
    ],
  },
];

export interface ClassifyResult {
  categories: Set<ToolCategory>;
  // "narrow" when at least one high-confidence match fires; "broad" when the
  // classifier couldn't decide and we should keep the full list.
  confidence: "narrow" | "broad";
}

export function classifyIntent(userMessage: string): ClassifyResult {
  const msg = userMessage.toLowerCase();
  const hits = new Set<ToolCategory>();
  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(msg))) hits.add(rule.category);
  }
  // Heuristic: if we hit 1–3 categories, that's a narrow request. 0 or ≥4
  // means keep the whole tool list — either the classifier missed, or the
  // message is broad enough that pruning would risk stripping something
  // the brain needs.
  const confidence: "narrow" | "broad" =
    hits.size >= 1 && hits.size <= 3 ? "narrow" : "broad";
  return { categories: hits, confidence };
}

// Filter a tool list down to ALWAYS_ON ∪ (tools matching any target
// category). Pass classifyIntent(userMessage) as `result`. If confidence is
// "broad" the function returns the input tools unchanged.
export function pruneTools(tools: ToolDef[], result: ClassifyResult): ToolDef[] {
  if (result.confidence === "broad" || result.categories.size === 0) return tools;
  return tools.filter((t) => {
    if (ALWAYS_ON.has(t.name)) return true;
    const cats = TOOL_CATEGORIES[t.name];
    if (!cats) return true; // Unknown tool → keep (safer).
    return cats.some((c) => result.categories.has(c));
  });
}
