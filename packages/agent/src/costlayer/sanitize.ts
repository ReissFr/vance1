// PII / secret stripping applied to every recorded tool input before a
// trajectory is shared across users. The goal is aggressive: anything that
// even looks personal is replaced with a placeholder, which the replayer
// then fills in from the current user's context at replay time.

import type { Trajectory, TrajectoryStep } from "./types";

// Field names that almost always carry sensitive values. We scrub them
// regardless of what the value looks like.
const SENSITIVE_KEYS = new Set([
  "password", "passwd", "pwd",
  "token", "access_token", "refresh_token", "auth",
  "secret", "api_key", "apikey", "key",
  "otp", "code", "pin",
  "ssn", "tax_id", "dob",
  "card", "card_number", "cvv", "cvc", "iban", "account_number",
  "authorization", "cookie",
  "address", "destination", "two_factor_token",
]);

// Values we still want present but generalised. "caption", "message", "body",
// etc. become {{caption}} / {{message}} / {{body}} so the replayer can fill
// them in from the current user's task.
const PROMPTABLE_KEYS = new Map<string, string>([
  ["caption", "caption"],
  ["message", "message"],
  ["text", "text"],
  ["body", "body"],
  ["content", "content"],
  ["subject", "subject"],
  ["note", "note"],
  ["query", "query"],
  ["search", "query"],
]);

// Regexes for scrubbing free-text fields. Order matters — longer / more
// specific patterns first.
const SCRUBBERS: [RegExp, string][] = [
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "{{email}}"],
  [/\bhttps?:\/\/\S+/g, "{{url}}"],
  [/\b(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?){2,4}\d{2,4}\b/g, "{{phone}}"],
  [/[£$€]\s*\d+(?:[.,]\d+)?/g, "{{amount}}"],
  [/\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/g, "{{card}}"],
  [/\b[A-Z]{2}\d{2}\s?(?:\w{4}\s?){1,7}\w{1,4}\b/g, "{{iban}}"],
  [/\b[A-Fa-f0-9]{32,}\b/g, "{{hex}}"],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "{{secret}}"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "{{secret}}"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "{{jwt}}"],
];

function scrubString(value: string): string {
  let out = value;
  for (const [re, placeholder] of SCRUBBERS) out = out.replace(re, placeholder);
  return out;
}

function sanitiseValue(key: string, value: unknown): unknown {
  const k = key.toLowerCase();
  if (SENSITIVE_KEYS.has(k)) return "{{redacted}}";
  const promptable = PROMPTABLE_KEYS.get(k);
  if (promptable && typeof value === "string" && value.length > 0) {
    return `{{${promptable}}}`;
  }
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => sanitiseValue(key, v));
  if (value && typeof value === "object") return sanitiseInput(value as Record<string, unknown>);
  return value;
}

export function sanitiseInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) out[k] = sanitiseValue(k, v);
  return out;
}

// Which tools are unsafe to ever share. Calls to these tools are dropped
// from a trajectory before it's saved cross-user.
const UNSHAREABLE_TOOLS = new Set<string>([
  "save_memory",
  "recall_memory",
  "recall_events",
  "read_email",
  "list_emails",
  "draft_email",
  "list_calendar_events",
  "create_calendar_event",
  "imessage_read",
  "imessage_send",
  "contacts_lookup",
  "notes_read",
  "notes_create",
  "obsidian_search",
  "payments_revenue",
  "payments_customers",
  "payments_charges",
  "payments_subscriptions",
  "commerce_orders",
  "commerce_products",
  "commerce_low_stock",
  "commerce_sales",
  "accounting_invoices",
  "accounting_expenses",
  "accounting_balances",
  "accounting_contacts",
  "banking_accounts",
  "banking_transactions",
  "banking_spending",
  "crypto_wallets",
  "crypto_portfolio",
  "crypto_transactions",
  "crypto_save_address",
  "crypto_list_addresses",
  "crypto_send",
  "list_pending_crypto_actions",
  "crypto_action_respond",
  "github_notifications",
]);

// Scan a full trajectory: drop unshareable tool calls, sanitise inputs on the
// rest. Also returns the list of placeholder variables that appear in the
// cleaned trajectory — the replayer fills these in at runtime.
export function sanitiseTrajectory(t: Trajectory): { trajectory: Trajectory; variables: string[] } {
  const vars = new Set<string>();
  const steps: TrajectoryStep[] = [];
  for (const step of t.steps) {
    if (UNSHAREABLE_TOOLS.has(step.tool)) continue;
    const cleanedInput = sanitiseInput(step.input);
    collectVariables(cleanedInput, vars);
    steps.push({
      tool: step.tool,
      input: cleanedInput,
      ...(step.expectedHint ? { expectedHint: step.expectedHint } : {}),
    });
  }
  return { trajectory: { version: t.version, steps }, variables: [...vars].sort() };
}

function collectVariables(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    for (const m of value.matchAll(/\{\{([a-z_][a-z0-9_]*)\}\}/gi)) {
      const name = (m[1] ?? "").toLowerCase();
      if (name && name !== "redacted") out.add(name);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectVariables(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectVariables(v, out);
  }
}
