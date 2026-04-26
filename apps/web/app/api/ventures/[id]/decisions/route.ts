// GET /api/ventures/[id]/decisions  — list decisions for a venture (filterable by status/tier).
// POST /api/ventures/[id]/decisions — manually propose a decision (skips the operator loop).

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_TIER = new Set(["auto", "notify", "approve"]);
const VALID_STATUS = new Set([
  "proposed", "auto_executed", "notified", "queued",
  "approved", "rejected", "overridden",
  "executed", "failed", "cancelled",
]);

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const tier = url.searchParams.get("tier");
  const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));

  let q = supabase
    .from("venture_decisions")
    .select("*")
    .eq("user_id", user.id)
    .eq("venture_id", id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status && status !== "all" && VALID_STATUS.has(status)) q = q.eq("status", status);
  if (tier && VALID_TIER.has(tier)) q = q.eq("tier", tier);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ decisions: data ?? [] });
}

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: {
    kind?: string;
    title?: string;
    body?: string;
    reasoning?: string;
    estimated_spend_pence?: number;
    confidence?: number;
    tier?: string;
  } = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const kind = String(body.kind ?? "").trim();
  const title = String(body.title ?? "").trim();
  const text = String(body.body ?? "").trim();
  if (kind.length < 2 || kind.length > 80) return NextResponse.json({ error: "kind 2-80 chars" }, { status: 400 });
  if (title.length < 2 || title.length > 280) return NextResponse.json({ error: "title 2-280 chars" }, { status: 400 });
  if (text.length < 4 || text.length > 4000) return NextResponse.json({ error: "body 4-4000 chars" }, { status: 400 });

  const conf = Math.max(1, Math.min(5, Math.round(body.confidence ?? 3)));
  const tier = body.tier && VALID_TIER.has(body.tier) ? body.tier : "approve";
  const status = tier === "auto" ? "auto_executed" : tier === "notify" ? "notified" : "queued";

  const { data, error } = await supabase
    .from("venture_decisions")
    .insert({
      user_id: user.id,
      venture_id: id,
      kind,
      title,
      body: text,
      reasoning: body.reasoning ? body.reasoning.slice(0, 4000) : null,
      estimated_spend_pence: Math.max(0, Math.round(body.estimated_spend_pence ?? 0)),
      confidence: conf,
      tier,
      status,
      executed_at: tier === "auto" || tier === "notify" ? new Date().toISOString() : null,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, decision: data });
}
