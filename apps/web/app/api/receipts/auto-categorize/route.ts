// Categorize uncategorized receipts in bulk with one Haiku call.
// Fetches up to 60 receipts where category IS NULL, asks the model for a
// category per row from a fixed taxonomy, then bulk-updates. Receipts where
// the model returns "unknown" are left untouched so they keep appearing as
// uncategorized until the user fixes them manually.

import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_RECEIPTS = 60;
const MAX_TOKENS = 2000;

const TAXONOMY = [
  "groceries",
  "takeaway",
  "dining",
  "travel",
  "transport",
  "fashion",
  "electronics",
  "books",
  "home",
  "subscriptions",
  "utilities",
  "health",
  "entertainment",
  "other",
];

type ReceiptLite = {
  id: string;
  merchant: string;
  amount: number | null;
  currency: string;
  description: string | null;
};

export async function POST(_req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const { data: rowsRaw, error: fetchErr } = await admin
    .from("receipts")
    .select("id, merchant, amount, currency, description")
    .eq("user_id", auth.user.id)
    .is("category", null)
    .eq("archived", false)
    .order("created_at", { ascending: false })
    .limit(MAX_RECEIPTS);
  if (fetchErr) {
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  }

  const rows = (rowsRaw ?? []) as ReceiptLite[];
  if (rows.length === 0) {
    return NextResponse.json({
      ok: true,
      categorized: 0,
      remaining: 0,
      note: "nothing to categorize",
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, error: "ANTHROPIC_API_KEY missing" }, { status: 500 });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userMsg = rows
    .map(
      (r, i) =>
        `[${i + 1}] id=${r.id} · ${r.merchant}${r.description ? ` — ${r.description.slice(0, 80)}` : ""}${
          r.amount != null ? ` · ${r.currency} ${r.amount.toFixed(2)}` : ""
        }`,
    )
    .join("\n");

  const systemPrompt = [
    "You categorize purchase receipts. For each input line, pick ONE category",
    `from this fixed taxonomy: ${TAXONOMY.join(", ")}.`,
    "Use 'unknown' if you genuinely can't tell (don't guess blindly — it's fine",
    "to leave some uncategorized).",
    "",
    "Reply as a JSON array only, one object per input line, same order:",
    '[{"id":"<receipt-id>","category":"<one-of-taxonomy-or-unknown>"}]',
    "",
    "No prose, no markdown, no explanation.",
  ].join("\n");

  let response: Anthropic.Messages.Message;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: userMsg }],
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
    .replace(/^```json\n?|\n?```$/g, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      return NextResponse.json(
        { ok: false, error: "model returned non-JSON", raw: text.slice(0, 500) },
        { status: 502 },
      );
    }
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return NextResponse.json({ ok: false, error: "model JSON invalid" }, { status: 502 });
    }
  }
  if (!Array.isArray(parsed)) {
    return NextResponse.json({ ok: false, error: "model reply not an array" }, { status: 502 });
  }

  const validIds = new Set(rows.map((r) => r.id));
  const byCategory = new Map<string, string[]>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : null;
    const cat = typeof o.category === "string" ? o.category.trim().toLowerCase() : null;
    if (!id || !validIds.has(id)) continue;
    if (!cat || cat === "unknown" || !TAXONOMY.includes(cat)) continue;
    const list = byCategory.get(cat) ?? [];
    list.push(id);
    byCategory.set(cat, list);
  }

  let categorized = 0;
  for (const [cat, ids] of byCategory) {
    const { error: updErr } = await admin
      .from("receipts")
      .update({ category: cat })
      .in("id", ids)
      .eq("user_id", auth.user.id)
      .is("category", null);
    if (updErr) {
      console.warn("[receipts/auto-categorize] update failed:", cat, updErr.message);
      continue;
    }
    categorized += ids.length;
  }

  return NextResponse.json({
    ok: true,
    categorized,
    scanned: rows.length,
    remaining: rows.length - categorized,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  });
}
