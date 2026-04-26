// Contacts index. Aggregates every counterparty we have either a commitment
// or a meeting with, and returns a ranked list: most important first
// (heaviest = open-commitment count, then last-interaction recency). Powers
// the /contacts overview page.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ContactRow = {
  email: string;
  name: string | null;
  open_count: number;
  closed_count: number;
  overdue_count: number;
  last_interaction_at: string | null;
  reliability: number | null;
};

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Pull everything we'll aggregate over in parallel.
  const [commitmentsRes, meetingsRes, recallRes] = await Promise.all([
    supabase
      .from("commitments")
      .select("direction, other_party, other_party_email, status, deadline, updated_at")
      .eq("user_id", user.id)
      .not("other_party_email", "is", null),
    supabase
      .from("meeting_sessions")
      .select("participants, started_at")
      .eq("user_id", user.id)
      .not("participants", "is", null)
      .order("started_at", { ascending: false })
      .limit(500),
    supabase
      .from("recall_events")
      .select("participants, occurred_at")
      .eq("user_id", user.id)
      .not("participants", "is", null)
      .order("occurred_at", { ascending: false })
      .limit(500),
  ]);

  const byEmail = new Map<
    string,
    {
      name: string | null;
      open: number;
      closed: number;
      overdue: number;
      lapsed: number;
      lastAt: string | null;
      // For reliability. delivered = status=done, lapsed = open>deadline+14d
      delivered: number;
    }
  >();

  const now = Date.now();
  const touch = (email: string) => {
    const k = email.trim().toLowerCase();
    if (!k || !k.includes("@")) return null;
    let row = byEmail.get(k);
    if (!row) {
      row = {
        name: null,
        open: 0,
        closed: 0,
        overdue: 0,
        lapsed: 0,
        lastAt: null,
        delivered: 0,
      };
      byEmail.set(k, row);
    }
    return row;
  };
  const bumpLast = (
    row: ReturnType<typeof touch>,
    ts: string | null,
  ) => {
    if (!row || !ts) return;
    if (!row.lastAt || ts > row.lastAt) row.lastAt = ts;
  };

  for (const c of commitmentsRes.data ?? []) {
    const email = c.other_party_email as string | null;
    if (!email) continue;
    const row = touch(email);
    if (!row) continue;
    if (!row.name && c.other_party) row.name = String(c.other_party);
    bumpLast(row, c.updated_at as string | null);
    if (c.status === "open") {
      row.open += 1;
      if (c.deadline && new Date(c.deadline as string).getTime() < now) {
        row.overdue += 1;
      }
      if (c.deadline) {
        const age = now - new Date(c.deadline as string).getTime();
        if (age > 14 * 24 * 60 * 60 * 1000) row.lapsed += 1;
      }
    } else if (c.status === "done") {
      row.closed += 1;
      row.delivered += 1;
    } else {
      row.closed += 1;
    }
  }

  for (const m of meetingsRes.data ?? []) {
    const participants = (m.participants as string[] | null) ?? [];
    for (const p of participants) {
      const row = touch(p);
      bumpLast(row, m.started_at as string | null);
    }
  }

  for (const r of recallRes.data ?? []) {
    const participants = (r.participants as string[] | null) ?? [];
    for (const p of participants) {
      const row = touch(p);
      bumpLast(row, r.occurred_at as string | null);
    }
  }

  const contacts: ContactRow[] = [];
  for (const [email, row] of byEmail.entries()) {
    const reliabilityTotal = row.delivered + row.lapsed;
    const reliability =
      reliabilityTotal >= 2 ? Number((row.delivered / reliabilityTotal).toFixed(2)) : null;
    contacts.push({
      email,
      name: row.name,
      open_count: row.open,
      closed_count: row.closed,
      overdue_count: row.overdue,
      last_interaction_at: row.lastAt,
      reliability,
    });
  }

  // Rank: overdue > open > recent interaction.
  contacts.sort((a, b) => {
    if (a.overdue_count !== b.overdue_count) return b.overdue_count - a.overdue_count;
    if (a.open_count !== b.open_count) return b.open_count - a.open_count;
    const aT = a.last_interaction_at ? new Date(a.last_interaction_at).getTime() : 0;
    const bT = b.last_interaction_at ? new Date(b.last_interaction_at).getTime() : 0;
    return bT - aT;
  });

  return NextResponse.json({ contacts: contacts.slice(0, 200) });
}
