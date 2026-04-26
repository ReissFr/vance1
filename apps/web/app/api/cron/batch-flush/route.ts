// Batch API orchestrator cron. Two passes per invocation:
//
//   1. flushPending(kind) — for each known kind, bundle queued rows into
//      one Anthropic batch and mark them submitted.
//
//   2. reapCompleted() — poll Anthropic for any submitted batches. When a
//      batch ends, write result_text back onto each row and run the
//      kind-specific finisher (registered in the agent package).
//
// Recommended cadence: every 10 minutes. Anthropic batches have up to 24h
// turnaround but typically complete much faster; frequent polling keeps
// finished results flowing back without wasted work.
//
// Auth: CRON_SECRET header convention (same as other crons).

import { type NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase/server";
import { flushPending, reapCompleted } from "@jarvis/agent";
// Import the distill module for its registerFinisher() side effect. Without
// this, the cron process doesn't know how to apply completed results.
import "@jarvis/agent";

export const runtime = "nodejs";
export const maxDuration = 300;

// Known kinds the cron should flush. Workers add their kind here when
// introducing a new batch-backed pipeline.
const KNOWN_KINDS = ["distill_conversation"] as const;

export async function POST(req: NextRequest) {
  return guarded(req, handle);
}

export async function GET(req: NextRequest) {
  return guarded(req, handle);
}

async function guarded(
  req: NextRequest,
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = req.headers.get("x-cron-secret");
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }
  return fn();
}

async function handle(): Promise<NextResponse> {
  const admin = supabaseAdmin();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const flushed: Record<string, { batchId: string | null; submitted: number; error?: string }> = {};
  for (const kind of KNOWN_KINDS) {
    try {
      flushed[kind] = await flushPending(admin, anthropic, kind);
    } catch (e) {
      flushed[kind] = {
        batchId: null,
        submitted: 0,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  let reaped: { completed: number; failed: number } | { error: string };
  try {
    reaped = await reapCompleted(admin, anthropic);
  } catch (e) {
    reaped = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({ ok: true, flushed, reaped });
}
