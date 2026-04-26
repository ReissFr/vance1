// GET /api/letters — list letters across time (§173) with stats.
//
// Query: ?direction=to_future_self|to_past_self|to_younger_self|all (default all)
//        ?status=scheduled|delivered|archived|pinned|all (default all but archived hidden)
//        ?limit=N (default 60, max 200)

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_DIRECTIONS = new Set(["to_future_self", "to_past_self", "to_younger_self"]);
const VALID_STATUSES = new Set(["scheduled", "delivered", "archived"]);

export async function GET(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const directionRaw = searchParams.get("direction") ?? "all";
  const statusRaw = searchParams.get("status") ?? "active";
  const limitRaw = parseInt(searchParams.get("limit") ?? "60", 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 60;

  let query = supabase
    .from("letters")
    .select("id, letter_text, direction, target_date, title, prompt_used, author_state_snapshot, target_state_snapshot, status, delivered_at, pinned, delivery_channels, created_at, updated_at")
    .eq("user_id", user.id)
    .order("target_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (directionRaw !== "all") {
    if (!VALID_DIRECTIONS.has(directionRaw)) return NextResponse.json({ error: "invalid direction" }, { status: 400 });
    query = query.eq("direction", directionRaw);
  }

  if (statusRaw === "pinned") {
    query = query.eq("pinned", true).neq("status", "archived");
  } else if (statusRaw === "all") {
    // include all
  } else if (statusRaw === "active") {
    query = query.neq("status", "archived");
  } else {
    if (!VALID_STATUSES.has(statusRaw)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
    query = query.eq("status", statusRaw);
  }

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string;
    direction: string;
    target_date: string;
    status: string;
    pinned: boolean;
    delivered_at: string | null;
    created_at: string;
  };
  const all = (rows ?? []) as Row[];

  const todayIso = new Date().toISOString().slice(0, 10);

  const stats = {
    total: all.length,
    scheduled: 0,
    delivered: 0,
    archived: 0,
    to_future_self: 0,
    to_past_self: 0,
    to_younger_self: 0,
    pinned: 0,
    next_scheduled: null as null | { id: string; target_date: string },
    most_recent_delivered: null as null | { id: string; delivered_at: string },
  };

  for (const r of all) {
    if (r.status === "scheduled") stats.scheduled++;
    else if (r.status === "delivered") stats.delivered++;
    else if (r.status === "archived") stats.archived++;
    if (r.direction === "to_future_self") stats.to_future_self++;
    else if (r.direction === "to_past_self") stats.to_past_self++;
    else if (r.direction === "to_younger_self") stats.to_younger_self++;
    if (r.pinned) stats.pinned++;
    if (r.status === "scheduled" && r.direction === "to_future_self" && r.target_date >= todayIso) {
      if (!stats.next_scheduled || r.target_date < stats.next_scheduled.target_date) {
        stats.next_scheduled = { id: r.id, target_date: r.target_date };
      }
    }
    if (r.status === "delivered" && r.delivered_at) {
      if (!stats.most_recent_delivered || r.delivered_at > stats.most_recent_delivered.delivered_at) {
        stats.most_recent_delivered = { id: r.id, delivered_at: r.delivered_at };
      }
    }
  }

  return NextResponse.json({ ok: true, letters: rows ?? [], stats });
}
