// GET /api/permission-slips — list permission-slips (§177) with stats.
//
// Query: ?status=open|signed_by_self|re_signed|refused|dismissed|pinned|archived|all (default open)
//        ?signer=self|parent|partner|peers|society|employer|profession|circumstance|unknown|all
//        ?domain=...|all
//        ?min_charge=1-5
//        ?min_confidence=1-5
//        ?limit=N (default 80, max 300)

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_SIGNERS = new Set([
  "self", "parent", "partner", "peers", "society",
  "employer", "profession", "circumstance", "unknown",
]);
const VALID_DOMAINS = new Set([
  "work", "health", "relationships", "family", "finance",
  "creative", "self", "spiritual", "other",
]);
const VALID_STATUSES = new Set([
  "open", "signed_by_self", "re_signed", "refused", "dismissed",
]);

export async function GET(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const statusRaw = searchParams.get("status") ?? "open";
  const signerRaw = searchParams.get("signer") ?? "all";
  const domainRaw = searchParams.get("domain") ?? "all";
  const minChargeRaw = parseInt(searchParams.get("min_charge") ?? "1", 10);
  const minConfRaw = parseInt(searchParams.get("min_confidence") ?? "2", 10);
  const limitRaw = parseInt(searchParams.get("limit") ?? "80", 10);

  const minCharge = Number.isFinite(minChargeRaw) ? Math.max(1, Math.min(5, minChargeRaw)) : 1;
  const minConf = Number.isFinite(minConfRaw) ? Math.max(1, Math.min(5, minConfRaw)) : 2;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(300, limitRaw)) : 80;

  let query = supabase
    .from("permission_slips")
    .select("id, scan_id, forbidden_action, signer, authority_text, domain, charge, recency, confidence, spoken_date, spoken_message_id, conversation_id, status, resolution_note, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at")
    .eq("user_id", user.id)
    .gte("charge", minCharge)
    .gte("confidence", minConf)
    .order("spoken_date", { ascending: false })
    .order("charge", { ascending: false })
    .limit(limit);

  if (statusRaw === "pinned") {
    query = query.eq("pinned", true).is("archived_at", null);
  } else if (statusRaw === "archived") {
    query = query.not("archived_at", "is", null);
  } else if (statusRaw !== "all") {
    if (!VALID_STATUSES.has(statusRaw)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
    query = query.eq("status", statusRaw).is("archived_at", null);
  } else {
    query = query.is("archived_at", null);
  }

  if (signerRaw !== "all") {
    if (!VALID_SIGNERS.has(signerRaw)) return NextResponse.json({ error: "invalid signer" }, { status: 400 });
    query = query.eq("signer", signerRaw);
  }

  if (domainRaw !== "all") {
    if (!VALID_DOMAINS.has(domainRaw)) return NextResponse.json({ error: "invalid domain" }, { status: 400 });
    query = query.eq("domain", domainRaw);
  }

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string;
    forbidden_action: string;
    signer: string;
    domain: string;
    charge: number;
    status: string;
    pinned: boolean;
    archived_at: string | null;
    spoken_date: string;
  };
  const all = (rows ?? []) as Row[];

  const stats = {
    total: all.length,
    open: 0,
    signed_by_self: 0,
    re_signed: 0,
    refused: 0,
    dismissed: 0,
    pinned: 0,
    load_bearing_open: 0,
    open_unsigned: 0,
    open_external_signer: 0,
    open_self_signed: 0,
    signer_counts: {} as Record<string, number>,
    open_signer_counts: {} as Record<string, number>,
    domain_counts: {} as Record<string, number>,
    biggest_open: null as null | { id: string; forbidden_action: string; charge: number; signer: string },
    most_common_signer: null as null | { signer: string; count: number },
    most_common_open_signer: null as null | { signer: string; count: number },
  };

  for (const r of all) {
    if (r.status === "open") stats.open++;
    else if (r.status === "signed_by_self") stats.signed_by_self++;
    else if (r.status === "re_signed") stats.re_signed++;
    else if (r.status === "refused") stats.refused++;
    else if (r.status === "dismissed") stats.dismissed++;
    if (r.pinned) stats.pinned++;
    if (r.charge === 5 && r.status === "open") stats.load_bearing_open++;
    stats.signer_counts[r.signer] = (stats.signer_counts[r.signer] ?? 0) + 1;
    stats.domain_counts[r.domain] = (stats.domain_counts[r.domain] ?? 0) + 1;
    if (r.status === "open") {
      stats.open_unsigned++;
      stats.open_signer_counts[r.signer] = (stats.open_signer_counts[r.signer] ?? 0) + 1;
      if (r.signer === "self") stats.open_self_signed++;
      else if (r.signer !== "unknown") stats.open_external_signer++;
      if (!stats.biggest_open || r.charge > stats.biggest_open.charge) {
        stats.biggest_open = { id: r.id, forbidden_action: r.forbidden_action, charge: r.charge, signer: r.signer };
      }
    }
  }

  let topSignerKey: string | null = null;
  let topSignerCount = 0;
  for (const [k, v] of Object.entries(stats.signer_counts)) {
    if (v > topSignerCount) { topSignerKey = k; topSignerCount = v; }
  }
  if (topSignerKey) stats.most_common_signer = { signer: topSignerKey, count: topSignerCount };

  let topOpenSignerKey: string | null = null;
  let topOpenSignerCount = 0;
  for (const [k, v] of Object.entries(stats.open_signer_counts)) {
    if (v > topOpenSignerCount) { topOpenSignerKey = k; topOpenSignerCount = v; }
  }
  if (topOpenSignerKey) stats.most_common_open_signer = { signer: topOpenSignerKey, count: topOpenSignerCount };

  return NextResponse.json({ ok: true, permission_slips: rows ?? [], stats });
}
