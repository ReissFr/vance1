// Receipts scanner. Sweeps the user's recent email for ONE-OFF purchase
// receipts (Amazon, Uber Eats, flight bookings, shop orders) and extracts
// structured rows to the `receipts` table. Paired with subscription-scan
// which handles RECURRING charges — together they answer "what did I buy?".
//
// Idempotent via dedup_key (lower(merchant)+amount+date). Runs server-side
// off a `tasks` row of kind=receipts_scan; kicked off by /api/receipts/scan.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmailProvider, type EmailSummary } from "@jarvis/integrations";

type ScanArgs = {
  title?: string;
  query?: string;
  max?: number;
  notify?: boolean;
};

type Extracted = {
  merchant: string;
  amount: number | null;
  currency: string;
  purchased_at: string | null;
  category: string | null;
  description: string | null;
  order_ref: string | null;
  confidence: number;
  source_email_id: string;
};

export type ReceiptsScanResult = {
  scanned_emails: number;
  new_receipts: number;
  updated_receipts: number;
  skipped: number;
  total_spend_by_currency: Record<string, number>;
};

const MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 8000;
const MAX_BODY_CHARS = 1200;

const DEFAULT_QUERY = [
  "newer_than:60d",
  "(receipt OR \"your order\" OR \"order confirmation\" OR \"order #\" OR",
  "\"your purchase\" OR \"thanks for your order\" OR invoice OR booking OR",
  "\"payment received\" OR \"we've charged\" OR \"payment confirmation\")",
  "-subscription -\"auto-renew\" -renewal",
].join(" ");

export async function runReceiptsScanTask(
  admin: SupabaseClient,
  taskId: string,
): Promise<void> {
  const { data: task, error: loadErr } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (loadErr || !task) {
    console.error("[receipts-scan] task not found:", taskId, loadErr?.message);
    return;
  }
  if (task.status !== "queued") return;

  const args: ScanArgs = task.args ?? {};
  const query = args.query ?? DEFAULT_QUERY;
  const max = Math.min(Math.max(args.max ?? 60, 10), 150);

  await admin
    .from("tasks")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", taskId);

  const emit = async (
    kind: "text" | "progress" | "error",
    content: string | null,
  ) => {
    await admin.from("task_events").insert({
      task_id: taskId,
      user_id: task.user_id,
      kind,
      content,
    });
  };

  try {
    const email = await getEmailProvider(admin, task.user_id);
    await emit("progress", `scanning last 60d via ${email.providerName} (max ${max})`);
    const raw = await email.list({ query, max });
    const emails: EmailSummary[] = raw.map((e) => ({
      ...e,
      body: e.body.slice(0, MAX_BODY_CHARS),
    }));
    await emit("progress", `fetched ${emails.length} email(s), extracting receipts…`);

    let extracted: Extracted[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    if (emails.length > 0) {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
      const systemPrompt = buildSystemPrompt();
      const userMsg = buildUserMessage(emails);

      let model = MODEL;
      let response: Anthropic.Messages.Message | null = null;
      for (let attempt = 0; attempt < 2 && !response; attempt++) {
        try {
          response = await anthropic.messages.create({
            model,
            max_tokens: MAX_TOKENS,
            system: systemPrompt,
            messages: [{ role: "user", content: userMsg }],
          });
        } catch (e) {
          if (attempt === 0 && isOverloadedError(e)) {
            model = FALLBACK_MODEL;
            continue;
          }
          throw e;
        }
      }
      if (!response) throw new Error("no response from model");

      inputTokens = response.usage.input_tokens;
      outputTokens = response.usage.output_tokens;

      const text = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      extracted = parseExtracted(text);
    }

    const persisted = await persistReceipts(admin, task.user_id, extracted);

    const result: ReceiptsScanResult = {
      scanned_emails: emails.length,
      new_receipts: persisted.newCount,
      updated_receipts: persisted.updatedCount,
      skipped: persisted.skipped,
      total_spend_by_currency: persisted.totals,
    };

    await admin
      .from("tasks")
      .update({
        status: "done",
        result: JSON.stringify(result),
        completed_at: new Date().toISOString(),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      })
      .eq("id", taskId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await emit("error", msg);
    await admin
      .from("tasks")
      .update({ status: "failed", error: msg, completed_at: new Date().toISOString() })
      .eq("id", taskId);
  }
}

function buildSystemPrompt(): string {
  return [
    "You are JARVIS's receipts-extractor. You receive the user's recent email",
    "and extract every ONE-OFF purchase receipt. Ignore RECURRING subscriptions",
    "(those are handled separately) and ignore marketing, shipping updates,",
    "and promo codes.",
    "",
    "For each receipt, extract:",
    "- merchant: canonical brand (e.g. 'Amazon', 'Uber Eats', 'Apple', 'Deliveroo').",
    "- amount: numeric total charged (null if not shown).",
    "- currency: ISO 4217 (GBP, USD, EUR…). Default GBP if not shown and user is UK-based.",
    "- purchased_at: ISO 8601 datetime of the purchase (or email date if no purchase time).",
    "- category: short label ('groceries','takeaway','electronics','travel','fashion','books','home','other').",
    "- description: short text (1 line, ≤70 chars) — what was bought.",
    "- order_ref: order number / booking reference if present, else null.",
    "- confidence: 0.0–1.0 (skip < 0.5).",
    "- source_email_id: the email id.",
    "",
    "Reply as a JSON array only — no prose, no markdown. Example:",
    '[{"merchant":"Amazon","amount":29.99,"currency":"GBP","purchased_at":"2026-04-18T10:00:00Z","category":"electronics","description":"Anker USB-C cable","order_ref":"123-4567","confidence":0.95,"source_email_id":"abc"}]',
  ].join("\n");
}

function buildUserMessage(emails: EmailSummary[]): string {
  return emails
    .map(
      (e, i) =>
        `[email_id=${e.id}] [${i + 1}]\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\n\n${e.body}`,
    )
    .join("\n\n---\n\n");
}

function parseExtracted(text: string): Extracted[] {
  const cleaned = text.trim().replace(/^```json\n?|\n?```$/g, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((r) => {
      if (!r || typeof r !== "object") return null;
      const o = r as Record<string, unknown>;
      if (typeof o.merchant !== "string" || !o.merchant.trim()) return null;
      if (typeof o.confidence !== "number" || o.confidence < 0.5) return null;
      if (typeof o.source_email_id !== "string") return null;
      return {
        merchant: o.merchant.trim(),
        amount: typeof o.amount === "number" ? o.amount : null,
        currency: typeof o.currency === "string" ? o.currency.toUpperCase() : "GBP",
        purchased_at: typeof o.purchased_at === "string" ? o.purchased_at : null,
        category: typeof o.category === "string" ? o.category : null,
        description: typeof o.description === "string" ? o.description.slice(0, 200) : null,
        order_ref: typeof o.order_ref === "string" ? o.order_ref : null,
        confidence: o.confidence,
        source_email_id: o.source_email_id,
      } satisfies Extracted;
    })
    .filter((r): r is Extracted => r !== null);
}

function dedupKey(r: Extracted): string {
  const dateKey = r.purchased_at ? r.purchased_at.slice(0, 10) : "nodate";
  const amount = r.amount != null ? r.amount.toFixed(2) : "noamt";
  return `${r.merchant.toLowerCase()}|${amount}|${dateKey}`;
}

async function persistReceipts(
  admin: SupabaseClient,
  userId: string,
  rows: Extracted[],
): Promise<{
  newCount: number;
  updatedCount: number;
  skipped: number;
  totals: Record<string, number>;
}> {
  let newCount = 0;
  let updatedCount = 0;
  let skipped = 0;
  const totals: Record<string, number> = {};

  for (const r of rows) {
    const key = dedupKey(r);
    const { data: existing } = await admin
      .from("receipts")
      .select("id, source_email_ids")
      .eq("user_id", userId)
      .eq("dedup_key", key)
      .maybeSingle();

    const existingIds = Array.isArray(existing?.source_email_ids)
      ? (existing!.source_email_ids as string[])
      : [];
    const mergedIds = existingIds.includes(r.source_email_id)
      ? existingIds
      : [...existingIds, r.source_email_id];

    if (existing) {
      await admin
        .from("receipts")
        .update({
          merchant: r.merchant,
          amount: r.amount,
          currency: r.currency,
          purchased_at: r.purchased_at,
          category: r.category,
          description: r.description,
          order_ref: r.order_ref,
          confidence: r.confidence,
          source_email_ids: mergedIds,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id as string);
      updatedCount += 1;
    } else {
      const { error } = await admin.from("receipts").insert({
        user_id: userId,
        merchant: r.merchant,
        dedup_key: key,
        amount: r.amount,
        currency: r.currency,
        purchased_at: r.purchased_at,
        category: r.category,
        description: r.description,
        order_ref: r.order_ref,
        confidence: r.confidence,
        source_email_ids: mergedIds,
      });
      if (error) {
        skipped += 1;
        continue;
      }
      newCount += 1;
    }

    if (r.amount != null) {
      totals[r.currency] = (totals[r.currency] ?? 0) + r.amount;
    }
  }

  return { newCount, updatedCount, skipped, totals };
}

function isOverloadedError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const msg = String((e as { message?: string }).message ?? "").toLowerCase();
  return msg.includes("overloaded") || msg.includes("529");
}
