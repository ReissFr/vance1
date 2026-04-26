// GET /api/latent-decisions — list candidates.
//   ?status=open|acknowledged|contested|dismissed|resolved|archived|pinned|all (default open)
//   ?kind=person|theme|habit|...
//   ?limit=N (default 30, max 100)

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "open";
  const kind = url.searchParams.get("kind");
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const limit = Math.max(1, Math.min(100, isNaN(limitRaw) ? 30 : limitRaw));

  let q = supabase
    .from("latent_decisions")
    .select("id, scan_id, kind, label, candidate_decision, evidence_summary, evidence_old, evidence_new, strength, source_signal, user_status, user_note, resulting_decision_id, pinned, archived_at, resolved_at, latency_ms, model, created_at")
    .eq("user_id", user.id);

  if (kind) q = q.eq("kind", kind);

  if (status === "open") q = q.is("user_status", null).is("archived_at", null);
  else if (status === "acknowledged") q = q.eq("user_status", "acknowledged");
  else if (status === "contested") q = q.eq("user_status", "contested");
  else if (status === "dismissed") q = q.eq("user_status", "dismissed");
  else if (status === "resolved") q = q.not("user_status", "is", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);

  q = q.order("strength", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ latent_decisions: data ?? [] });
}
