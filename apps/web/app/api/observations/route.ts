// GET /api/observations — list observations with filters.
// POST /api/observations — manually add an observation (rare; usually
// generated via /generate). The generate route runs the Haiku scan.
//
// GET query params:
//   ?kind=pattern|contradiction|blind_spot|growth|encouragement|question
//   ?status=active|dismissed|pinned|all   (default: active — pinned + non-dismissed)
//   ?window_days=7|14|30|60               (filter by which scan they came from)
//   ?limit=N                              (default 80)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const KINDS = ["pattern", "contradiction", "blind_spot", "growth", "encouragement", "question"];

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const status = url.searchParams.get("status") ?? "active";
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "80", 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 80;

  let q = supabase
    .from("observations")
    .select("id, kind, body, confidence, source_refs, window_days, pinned, dismissed_at, created_at")
    .eq("user_id", user.id);

  if (kind && KINDS.includes(kind)) q = q.eq("kind", kind);
  if (status === "active") q = q.is("dismissed_at", null);
  else if (status === "dismissed") q = q.not("dismissed_at", "is", null);
  else if (status === "pinned") q = q.eq("pinned", true).is("dismissed_at", null);
  // status === "all" → no extra filter

  q = q.order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ observations: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { kind?: string; body?: string; confidence?: number; source_refs?: unknown; window_days?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  if (!body.kind || !KINDS.includes(body.kind)) return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  const text = (body.body ?? "").trim();
  if (text.length < 4) return NextResponse.json({ error: "body required" }, { status: 400 });

  const { data, error } = await supabase
    .from("observations")
    .insert({
      user_id: user.id,
      kind: body.kind,
      body: text.slice(0, 1000),
      confidence: typeof body.confidence === "number" ? Math.max(1, Math.min(5, Math.round(body.confidence))) : 3,
      source_refs: Array.isArray(body.source_refs) ? body.source_refs : [],
      window_days: typeof body.window_days === "number" ? body.window_days : 30,
    })
    .select("id, kind, body, confidence, source_refs, window_days, pinned, dismissed_at, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ observation: data });
}
