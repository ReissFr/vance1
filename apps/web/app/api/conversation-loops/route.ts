// GET /api/conversation-loops — list detected conversation loops.
//   ?status=open|named|resolved|contested|dismissed|any_resolved|archived|pinned|all
//     (default open)
//   ?domain=energy|mood|focus|time|decisions|relationships|work|identity|money|mixed
//   ?limit=N (default 40, max 100)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "open";
  const domain = url.searchParams.get("domain");
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "40", 10);
  const limit = Math.max(1, Math.min(100, isNaN(limitRaw) ? 40 : limitRaw));

  let q = supabase
    .from("conversation_loops")
    .select("id, scan_id, loop_label, recurring_question, pattern_summary, domain, occurrence_count, span_days, first_seen_at, last_seen_at, sample_quotes, candidate_exit, strength, user_status, user_note, resolution_text, resolved_at, pinned, archived_at, latency_ms, model, created_at")
    .eq("user_id", user.id);

  if (domain) q = q.eq("domain", domain);

  if (status === "open") q = q.is("user_status", null).is("archived_at", null);
  else if (status === "named") q = q.eq("user_status", "named");
  else if (status === "resolved") q = q.eq("user_status", "resolved");
  else if (status === "contested") q = q.eq("user_status", "contested");
  else if (status === "dismissed") q = q.eq("user_status", "dismissed");
  else if (status === "any_resolved") q = q.not("user_status", "is", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);

  q = q.order("strength", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ conversation_loops: data ?? [] });
}
