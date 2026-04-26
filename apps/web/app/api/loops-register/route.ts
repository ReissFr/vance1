// §174 — list endpoint for the LOOPS REGISTER.
// Filters: status / loop_kind / domain / min_amplitude / min_chronicity_days / pinned.
// Stats include chronic_active (chronicity > 180d AND status=active),
// escalating_active, settled_count, by_kind / by_domain / by_velocity buckets,
// avg amplitude/chronicity for active, and biggest active amplitude.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_STATUS = new Set(["active", "broken", "widened", "settled", "archived", "dismissed"]);
const VALID_KIND = new Set([
  "question", "fear", "problem", "fantasy", "scene_replay",
  "grievance", "craving", "regret_gnaw", "other",
]);
const VALID_DOMAIN = new Set([
  "work", "health", "relationships", "family", "finance",
  "creative", "self", "spiritual", "other",
]);

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const kind = url.searchParams.get("kind");
  const domain = url.searchParams.get("domain");
  const velocity = url.searchParams.get("velocity");
  const minAmpRaw = url.searchParams.get("min_amplitude");
  const minChronRaw = url.searchParams.get("min_chronicity_days");
  const pinnedOnly = url.searchParams.get("pinned") === "true";
  const includeArchived = url.searchParams.get("include_archived") === "true";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1), 500);

  let q = supabase
    .from("loops")
    .select("id, scan_id, topic_text, loop_kind, domain, first_seen_date, last_seen_date, occurrence_count, distinct_chat_count, chronicity_days, amplitude, velocity, confidence, evidence_message_ids, status, status_note, resolved_at, pinned, archived_at, created_at, updated_at")
    .eq("user_id", user.id)
    .order("pinned", { ascending: false })
    .order("amplitude", { ascending: false })
    .order("last_seen_date", { ascending: false })
    .limit(limit);

  if (!includeArchived) q = q.is("archived_at", null);
  if (status && VALID_STATUS.has(status)) q = q.eq("status", status);
  if (kind && VALID_KIND.has(kind)) q = q.eq("loop_kind", kind);
  if (domain && VALID_DOMAIN.has(domain)) q = q.eq("domain", domain);
  if (velocity && ["escalating", "stable", "dampening", "dormant"].includes(velocity)) q = q.eq("velocity", velocity);
  if (minAmpRaw) {
    const n = parseInt(minAmpRaw, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 5) q = q.gte("amplitude", n);
  }
  if (minChronRaw) {
    const n = parseInt(minChronRaw, 10);
    if (Number.isFinite(n) && n >= 0) q = q.gte("chronicity_days", n);
  }
  if (pinnedOnly) q = q.eq("pinned", true);

  const { data: loops, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: statRows } = await supabase
    .from("loops")
    .select("loop_kind, domain, velocity, amplitude, chronicity_days, status, pinned")
    .eq("user_id", user.id)
    .is("archived_at", null);

  const stats = {
    total: 0,
    active: 0,
    broken: 0,
    widened: 0,
    settled: 0,
    dismissed: 0,
    pinned: 0,
    chronic_active: 0,
    escalating_active: 0,
    dormant_active: 0,
    avg_amplitude_active: 0,
    avg_chronicity_active: 0,
    biggest_active_amplitude: 0,
    by_kind: {} as Record<string, number>,
    by_domain: {} as Record<string, number>,
    by_velocity: {} as Record<string, number>,
  };

  if (statRows && statRows.length > 0) {
    let activeAmpSum = 0;
    let activeChronSum = 0;
    let activeCount = 0;
    for (const r of statRows as Array<{
      loop_kind: string; domain: string; velocity: string;
      amplitude: number; chronicity_days: number; status: string; pinned: boolean;
    }>) {
      stats.total += 1;
      if (r.status === "active") stats.active += 1;
      else if (r.status === "broken") stats.broken += 1;
      else if (r.status === "widened") stats.widened += 1;
      else if (r.status === "settled") stats.settled += 1;
      else if (r.status === "dismissed") stats.dismissed += 1;
      if (r.pinned) stats.pinned += 1;
      stats.by_kind[r.loop_kind] = (stats.by_kind[r.loop_kind] || 0) + 1;
      stats.by_domain[r.domain] = (stats.by_domain[r.domain] || 0) + 1;
      stats.by_velocity[r.velocity] = (stats.by_velocity[r.velocity] || 0) + 1;

      if (r.status === "active") {
        activeCount += 1;
        activeAmpSum += r.amplitude;
        activeChronSum += r.chronicity_days;
        if (r.chronicity_days > 180) stats.chronic_active += 1;
        if (r.velocity === "escalating") stats.escalating_active += 1;
        if (r.velocity === "dormant") stats.dormant_active += 1;
        if (r.amplitude > stats.biggest_active_amplitude) stats.biggest_active_amplitude = r.amplitude;
      }
    }
    if (activeCount > 0) {
      stats.avg_amplitude_active = Math.round((activeAmpSum / activeCount) * 100) / 100;
      stats.avg_chronicity_active = Math.round(activeChronSum / activeCount);
    }
  }

  return NextResponse.json({ ok: true, loops: loops ?? [], stats });
}
