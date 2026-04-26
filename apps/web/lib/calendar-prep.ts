// Shared event-prep builder. Given a calendar event + user, returns the
// chief-of-staff context — recall hits with attendees (last 90d) + any open
// commitments with those counterparties. Used by:
//   - /api/calendar/prep (PREP button on Today)
//   - proactive loop (15min-before pre-meeting ping)

import type { SupabaseClient } from "@supabase/supabase-js";
import { searchRecall } from "./recall";

export type PrepEventInput = {
  id: string;
  summary: string;
  attendees: string[];
};

export type PrepRelated = {
  source: string;
  title: string | null;
  snippet: string;
  occurred_at: string | null;
};

export type PrepCommitment = {
  id: string;
  direction: "outbound" | "inbound";
  other_party: string;
  other_party_email: string | null;
  commitment_text: string;
  deadline: string | null;
};

export type EventPrep = {
  related: PrepRelated[];
  commitments: PrepCommitment[];
};

export async function buildEventPrep(
  admin: SupabaseClient,
  userId: string,
  event: PrepEventInput,
): Promise<EventPrep> {
  const attendeesLower = event.attendees.map((a) => a.toLowerCase());
  const attendeesLocal = event.attendees
    .map((a) => a.split("@")[0]?.replace(/[._-]/g, " ").trim())
    .filter((s): s is string => Boolean(s));

  const query = [event.summary, ...attendeesLocal].join(" ").slice(0, 400);

  const [related, commitments] = await Promise.all([
    searchRelated(admin, userId, query),
    findOpenCommitments(admin, userId, attendeesLower, attendeesLocal),
  ]);

  return { related, commitments };
}

async function searchRelated(
  admin: SupabaseClient,
  userId: string,
  query: string,
): Promise<PrepRelated[]> {
  if (!query.trim()) return [];
  try {
    const sinceISO = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const hits = await searchRecall(admin, userId, query, {
      matchCount: 8,
      sinceISO,
    });
    return hits.slice(0, 6).map((h) => ({
      source: h.source,
      title: h.title ?? null,
      snippet: (h.body ?? "").slice(0, 280),
      occurred_at: h.occurred_at ?? null,
    }));
  } catch {
    return [];
  }
}

async function findOpenCommitments(
  admin: SupabaseClient,
  userId: string,
  attendeeEmailsLower: string[],
  attendeeNames: string[],
): Promise<PrepCommitment[]> {
  const byId = new Map<string, PrepCommitment>();

  if (attendeeEmailsLower.length > 0) {
    const { data } = await admin
      .from("commitments")
      .select("id, direction, other_party, other_party_email, commitment_text, deadline")
      .eq("user_id", userId)
      .eq("status", "open")
      .in("other_party_email", attendeeEmailsLower);
    for (const r of data ?? []) {
      byId.set(r.id as string, {
        id: r.id as string,
        direction: r.direction as "outbound" | "inbound",
        other_party: r.other_party as string,
        other_party_email: (r.other_party_email as string | null) ?? null,
        commitment_text: r.commitment_text as string,
        deadline: (r.deadline as string | null) ?? null,
      });
    }
  }

  for (const name of attendeeNames) {
    if (name.length < 3) continue;
    const { data } = await admin
      .from("commitments")
      .select("id, direction, other_party, other_party_email, commitment_text, deadline")
      .eq("user_id", userId)
      .eq("status", "open")
      .ilike("other_party", `%${name}%`)
      .limit(8);
    for (const r of data ?? []) {
      if (!byId.has(r.id as string)) {
        byId.set(r.id as string, {
          id: r.id as string,
          direction: r.direction as "outbound" | "inbound",
          other_party: r.other_party as string,
          other_party_email: (r.other_party_email as string | null) ?? null,
          commitment_text: r.commitment_text as string,
          deadline: (r.deadline as string | null) ?? null,
        });
      }
    }
  }

  return Array.from(byId.values()).slice(0, 10);
}
