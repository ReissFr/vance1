// Aggregates token usage + estimated cost from the `messages` table for a
// given time window. Powers the `/costs` dashboard.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { costForTokens, pricingTable } from "@/lib/llm-pricing";

export const runtime = "nodejs";

type Row = {
  conversation_id: string;
  role: string;
  model_tier: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  created_at: string;
};

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const days = Math.max(1, Math.min(Number(searchParams.get("days") ?? 30), 90));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const admin = supabaseAdmin();
  const { data: messages, error } = await admin
    .from("messages")
    .select(
      "conversation_id, role, model_tier, input_tokens, output_tokens, cache_read_tokens, created_at",
    )
    .eq("user_id", user.id)
    .eq("role", "assistant")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (messages ?? []) as Row[];

  const totals = {
    calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cost_usd: 0,
  };

  const perDayMap: Record<
    string,
    { date: string; calls: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cost_usd: number }
  > = {};
  const perModelMap: Record<
    string,
    { tier: string; calls: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cost_usd: number }
  > = {};
  const perConvMap: Record<
    string,
    { conversation_id: string; calls: number; cost_usd: number }
  > = {};

  for (const r of rows) {
    const cost = costForTokens(
      r.model_tier,
      r.input_tokens,
      r.output_tokens,
      r.cache_read_tokens,
    );
    totals.calls += 1;
    totals.input_tokens += r.input_tokens ?? 0;
    totals.output_tokens += r.output_tokens ?? 0;
    totals.cache_read_tokens += r.cache_read_tokens ?? 0;
    totals.cost_usd += cost;

    const day = r.created_at.slice(0, 10);
    const dayBucket =
      perDayMap[day] ??
      (perDayMap[day] = {
        date: day,
        calls: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cost_usd: 0,
      });
    dayBucket.calls += 1;
    dayBucket.input_tokens += r.input_tokens ?? 0;
    dayBucket.output_tokens += r.output_tokens ?? 0;
    dayBucket.cache_read_tokens += r.cache_read_tokens ?? 0;
    dayBucket.cost_usd += cost;

    const tier = r.model_tier ?? "unknown";
    const tierBucket =
      perModelMap[tier] ??
      (perModelMap[tier] = {
        tier,
        calls: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cost_usd: 0,
      });
    tierBucket.calls += 1;
    tierBucket.input_tokens += r.input_tokens ?? 0;
    tierBucket.output_tokens += r.output_tokens ?? 0;
    tierBucket.cache_read_tokens += r.cache_read_tokens ?? 0;
    tierBucket.cost_usd += cost;

    const conv =
      perConvMap[r.conversation_id] ??
      (perConvMap[r.conversation_id] = {
        conversation_id: r.conversation_id,
        calls: 0,
        cost_usd: 0,
      });
    conv.calls += 1;
    conv.cost_usd += cost;
  }

  const perDay: typeof perDayMap[string][] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    perDay.push(
      perDayMap[d] ?? {
        date: d,
        calls: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cost_usd: 0,
      },
    );
  }

  const perModel = Object.values(perModelMap).sort(
    (a, b) => b.cost_usd - a.cost_usd,
  );

  const topConvIds = Object.values(perConvMap)
    .sort((a, b) => b.cost_usd - a.cost_usd)
    .slice(0, 8);
  const convTitles: Record<string, string> = {};
  if (topConvIds.length > 0) {
    const { data: convs } = await admin
      .from("conversations")
      .select("id, title")
      .in(
        "id",
        topConvIds.map((c) => c.conversation_id),
      );
    for (const c of (convs ?? []) as Array<{ id: string; title: string | null }>) {
      convTitles[c.id] = c.title ?? "Untitled";
    }
  }
  const topConversations = topConvIds.map((c) => ({
    ...c,
    title: convTitles[c.conversation_id] ?? "Untitled",
    cost_usd: round4(c.cost_usd),
  }));

  return NextResponse.json({
    days,
    totals: {
      calls: totals.calls,
      input_tokens: totals.input_tokens,
      output_tokens: totals.output_tokens,
      cache_read_tokens: totals.cache_read_tokens,
      cost_usd: round4(totals.cost_usd),
    },
    perDay: perDay.map((d) => ({ ...d, cost_usd: round4(d.cost_usd) })),
    perModel: perModel.map((m) => ({ ...m, cost_usd: round4(m.cost_usd) })),
    topConversations,
    pricing: pricingTable(),
  });
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
