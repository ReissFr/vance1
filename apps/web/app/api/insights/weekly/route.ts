// Weekly insights — compares the last 7 days against the prior 7 days across
// tasks, commitments, receipts, subscriptions, and memory captures. Powers
// the /insights dashboard.

import { NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Bucket = {
  total: number;
  succeeded: number;
  failed: number;
  cost: number;
};

type DailyPoint = { date: string; total: number; cost: number };

export async function GET() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const thisStart = new Date(now - 7 * day).toISOString();
  const priorStart = new Date(now - 14 * day).toISOString();
  const priorEnd = thisStart;

  const admin = supabaseAdmin();

  const [tasks14d, commitOpened, commitClosed, receipts14d, subs14d, memory14d] =
    await Promise.all([
      admin
        .from("tasks")
        .select("kind, status, cost_usd, created_at")
        .eq("user_id", user.id)
        .gte("created_at", priorStart)
        .limit(10000),
      admin
        .from("commitments")
        .select("id, created_at")
        .eq("user_id", user.id)
        .gte("created_at", priorStart)
        .limit(5000),
      admin
        .from("commitments")
        .select("id, updated_at, status")
        .eq("user_id", user.id)
        .in("status", ["done", "cancelled"])
        .gte("updated_at", priorStart)
        .limit(5000),
      admin
        .from("receipts")
        .select("id, amount, currency, purchased_at, created_at")
        .eq("user_id", user.id)
        .gte("created_at", priorStart)
        .limit(5000),
      admin
        .from("subscriptions")
        .select("id, amount, currency, created_at")
        .eq("user_id", user.id)
        .gte("created_at", priorStart)
        .limit(2000),
      admin
        .from("memories")
        .select("id, created_at")
        .eq("user_id", user.id)
        .gte("created_at", priorStart)
        .limit(5000),
    ]);

  const taskRows = (tasks14d.data ?? []) as Array<{
    kind: string | null;
    status: string | null;
    cost_usd: number | null;
    created_at: string;
  }>;

  const thisBucket: Bucket = { total: 0, succeeded: 0, failed: 0, cost: 0 };
  const priorBucket: Bucket = { total: 0, succeeded: 0, failed: 0, cost: 0 };
  const kindThis: Record<string, Bucket> = {};
  const daily: Record<string, { total: number; cost: number }> = {};

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * day);
    const key = d.toISOString().slice(0, 10);
    daily[key] = { total: 0, cost: 0 };
  }

  for (const r of taskRows) {
    const ts = new Date(r.created_at).getTime();
    const cost = Number(r.cost_usd ?? 0);
    const target = ts >= new Date(thisStart).getTime() ? thisBucket : priorBucket;
    target.total += 1;
    target.cost += cost;
    if (r.status === "done") target.succeeded += 1;
    else if (r.status === "failed") target.failed += 1;

    if (ts >= new Date(thisStart).getTime()) {
      const kind = r.kind ?? "unknown";
      const kb =
        kindThis[kind] ??
        (kindThis[kind] = { total: 0, succeeded: 0, failed: 0, cost: 0 });
      kb.total += 1;
      kb.cost += cost;
      if (r.status === "done") kb.succeeded += 1;
      else if (r.status === "failed") kb.failed += 1;

      const dayKey = r.created_at.slice(0, 10);
      if (daily[dayKey]) {
        daily[dayKey].total += 1;
        daily[dayKey].cost += cost;
      }
    }
  }

  const commitOpenedRows = (commitOpened.data ?? []) as Array<{ created_at: string }>;
  const commitClosedRows = (commitClosed.data ?? []) as Array<{ updated_at: string }>;
  const receiptRows = (receipts14d.data ?? []) as Array<{
    amount: number | null;
    currency: string | null;
    created_at: string;
  }>;
  const subRows = (subs14d.data ?? []) as Array<{ created_at: string }>;
  const memoryRows = (memory14d.data ?? []) as Array<{ created_at: string }>;

  const splitCount = (rows: Array<{ ts: string }>) => {
    let thisN = 0;
    let priorN = 0;
    const cutoff = new Date(thisStart).getTime();
    for (const r of rows) {
      if (new Date(r.ts).getTime() >= cutoff) thisN += 1;
      else priorN += 1;
    }
    return { this: thisN, prior: priorN };
  };

  const commitOpenedSplit = splitCount(
    commitOpenedRows.map((r) => ({ ts: r.created_at })),
  );
  const commitClosedSplit = splitCount(
    commitClosedRows.map((r) => ({ ts: r.updated_at })),
  );
  const memorySplit = splitCount(
    memoryRows.map((r) => ({ ts: r.created_at })),
  );
  const subsSplit = splitCount(subRows.map((r) => ({ ts: r.created_at })));

  const receiptSpendThis: Record<string, number> = {};
  const receiptSpendPrior: Record<string, number> = {};
  let receiptCountThis = 0;
  let receiptCountPrior = 0;
  const cutoff = new Date(thisStart).getTime();
  for (const r of receiptRows) {
    const ts = new Date(r.created_at).getTime();
    const cur = (r.currency ?? "USD").toUpperCase();
    const amt = Number(r.amount ?? 0);
    if (ts >= cutoff) {
      receiptSpendThis[cur] = (receiptSpendThis[cur] ?? 0) + amt;
      receiptCountThis += 1;
    } else {
      receiptSpendPrior[cur] = (receiptSpendPrior[cur] ?? 0) + amt;
      receiptCountPrior += 1;
    }
  }

  const topKinds = Object.entries(kindThis)
    .map(([kind, b]) => {
      const terminal = b.succeeded + b.failed;
      return {
        kind,
        total: b.total,
        cost: round4(b.cost),
        success_rate: terminal > 0 ? b.succeeded / terminal : null,
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const failingKinds = Object.entries(kindThis)
    .filter(([, b]) => b.failed > 0)
    .map(([kind, b]) => ({
      kind,
      failed: b.failed,
      total: b.total,
      success_rate:
        b.succeeded + b.failed > 0 ? b.succeeded / (b.succeeded + b.failed) : null,
    }))
    .sort((a, b) => b.failed - a.failed)
    .slice(0, 5);

  const dailySeries: DailyPoint[] = Object.entries(daily).map(([date, v]) => ({
    date,
    total: v.total,
    cost: round4(v.cost),
  }));

  return NextResponse.json({
    window: {
      this_start: thisStart,
      prior_start: priorStart,
      prior_end: priorEnd,
    },
    tasks: {
      this: {
        total: thisBucket.total,
        succeeded: thisBucket.succeeded,
        failed: thisBucket.failed,
        cost: round4(thisBucket.cost),
        success_rate:
          thisBucket.succeeded + thisBucket.failed > 0
            ? thisBucket.succeeded /
              (thisBucket.succeeded + thisBucket.failed)
            : null,
      },
      prior: {
        total: priorBucket.total,
        succeeded: priorBucket.succeeded,
        failed: priorBucket.failed,
        cost: round4(priorBucket.cost),
        success_rate:
          priorBucket.succeeded + priorBucket.failed > 0
            ? priorBucket.succeeded /
              (priorBucket.succeeded + priorBucket.failed)
            : null,
      },
      daily: dailySeries,
      top_kinds: topKinds,
      failing_kinds: failingKinds,
    },
    commitments: {
      opened: commitOpenedSplit,
      closed: commitClosedSplit,
    },
    receipts: {
      count: { this: receiptCountThis, prior: receiptCountPrior },
      spend_this: round4Map(receiptSpendThis),
      spend_prior: round4Map(receiptSpendPrior),
    },
    subscriptions: {
      detected: subsSplit,
    },
    memory: {
      captured: memorySplit,
    },
  });
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round4Map(m: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) out[k] = round4(v);
  return out;
}
