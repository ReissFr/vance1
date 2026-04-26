// Retrospective synthesis — pulls wins, reflections, decisions, blockers,
// intentions across a date range and returns a unified chronological view.
// No new table; this is a read-only aggregator that's the payoff for all the
// journal layers feeding into it.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Item = {
  kind: "win" | "reflection" | "decision" | "blocker" | "intention";
  subkind?: string | null;
  date: string; // YYYY-MM-DD
  iso: string; // full ISO ts for ordering
  title?: string | null;
  body: string;
  tags?: string[] | null;
  amount_cents?: number | null;
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}

function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const daysRaw = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(90, Math.round(daysRaw)) : 7;
  const sinceDate = new Date(Date.now() - days * 86400000);
  const sinceIso = sinceDate.toISOString();
  const sinceYmd = ymd(sinceDate);

  const items: Item[] = [];

  // wins
  const { data: wins } = await supabase
    .from("wins")
    .select("id, text, kind, amount_cents, created_at")
    .eq("user_id", user.id)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false });
  for (const w of (wins ?? []) as Array<{
    id: string;
    text: string;
    kind: string;
    amount_cents: number | null;
    created_at: string;
  }>) {
    items.push({
      kind: "win",
      subkind: w.kind,
      date: dateKey(w.created_at),
      iso: w.created_at,
      body: w.text,
      amount_cents: w.amount_cents,
    });
  }

  // reflections
  const { data: refls } = await supabase
    .from("reflections")
    .select("id, text, kind, tags, created_at")
    .eq("user_id", user.id)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false });
  for (const r of (refls ?? []) as Array<{
    id: string;
    text: string;
    kind: string;
    tags: string[];
    created_at: string;
  }>) {
    items.push({
      kind: "reflection",
      subkind: r.kind,
      date: dateKey(r.created_at),
      iso: r.created_at,
      body: r.text,
      tags: r.tags,
    });
  }

  // decisions made (use created_at)
  const { data: decs } = await supabase
    .from("decisions")
    .select("id, title, choice, outcome_label, created_at, reviewed_at")
    .eq("user_id", user.id)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false });
  for (const d of (decs ?? []) as Array<{
    id: string;
    title: string;
    choice: string;
    outcome_label: string | null;
    created_at: string;
    reviewed_at: string | null;
  }>) {
    items.push({
      kind: "decision",
      subkind: d.outcome_label ?? (d.reviewed_at ? "reviewed" : "open"),
      date: dateKey(d.created_at),
      iso: d.created_at,
      title: d.title,
      body: d.choice,
    });
  }

  // standups → blockers + intentions ("today" field)
  const { data: standups } = await supabase
    .from("standups")
    .select("id, log_date, today, blockers")
    .eq("user_id", user.id)
    .gte("log_date", sinceYmd)
    .order("log_date", { ascending: false });
  for (const s of (standups ?? []) as Array<{
    id: string;
    log_date: string;
    today: string | null;
    blockers: string | null;
  }>) {
    if (s.blockers && s.blockers.trim()) {
      items.push({
        kind: "blocker",
        date: s.log_date,
        iso: `${s.log_date}T08:00:00.000Z`,
        body: s.blockers.trim(),
      });
    }
  }

  // intentions
  const { data: intents } = await supabase
    .from("intentions")
    .select("id, log_date, text, completed_at")
    .eq("user_id", user.id)
    .gte("log_date", sinceYmd)
    .order("log_date", { ascending: false });
  for (const it of (intents ?? []) as Array<{
    id: string;
    log_date: string;
    text: string;
    completed_at: string | null;
  }>) {
    items.push({
      kind: "intention",
      subkind: it.completed_at ? "completed" : "set",
      date: it.log_date,
      iso: `${it.log_date}T07:00:00.000Z`,
      body: it.text,
    });
  }

  // sort all items chronologically descending
  items.sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0));

  // counts per kind
  const counts: Record<string, number> = {};
  for (const it of items) counts[it.kind] = (counts[it.kind] ?? 0) + 1;

  return NextResponse.json({
    days,
    since: sinceYmd,
    counts,
    items,
  });
}
