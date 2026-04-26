// Contact profile — given an email, returns the chief-of-staff view of that
// counterparty: commitments (open + closed), meetings where they were a
// participant, and recent recall events that mention them. Powers the
// /contacts?email=… page.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Commitment = {
  id: string;
  direction: "outbound" | "inbound";
  other_party: string;
  other_party_email: string | null;
  commitment_text: string;
  deadline: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  source_kind: string | null;
  source_meeting_title: string | null;
};

type Meeting = {
  id: string;
  title: string | null;
  started_at: string;
  summary: string | null;
};

type RecallHit = {
  id: string;
  source: string;
  title: string | null;
  snippet: string;
  occurred_at: string;
};

type Reliability = {
  // outbound = user owes them. Ratio of delivered (done) vs total resolved
  // (done + overdue-expired). null when we don't have enough samples.
  outbound: { delivered: number; lapsed: number; ratio: number | null };
  inbound: { delivered: number; lapsed: number; ratio: number | null };
};

type ContactProfile = {
  email: string;
  name: string | null;
  commitments: { open: Commitment[]; closed: Commitment[] };
  meetings: Meeting[];
  recall: RecallHit[];
  reliability: Reliability;
};

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const emailRaw = searchParams.get("email");
  if (!emailRaw) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  const email = emailRaw.trim().toLowerCase();
  if (!email.includes("@")) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  const [commitmentsRes, meetingsRes, recallRes] = await Promise.all([
    supabase
      .from("commitments")
      .select(
        "id, direction, other_party, other_party_email, commitment_text, deadline, status, created_at, updated_at, source_kind, source_meeting_title",
      )
      .eq("user_id", user.id)
      .eq("other_party_email", email)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("meeting_sessions")
      .select("id, title, started_at, summary")
      .eq("user_id", user.id)
      .contains("participants", [email])
      .order("started_at", { ascending: false })
      .limit(20),
    supabase
      .from("recall_events")
      .select("id, source, title, body, occurred_at")
      .eq("user_id", user.id)
      .contains("participants", [email])
      .order("occurred_at", { ascending: false })
      .limit(20),
  ]);

  const commitments = (commitmentsRes.data ?? []) as Commitment[];
  const open = commitments.filter((c) => c.status === "open");
  const closed = commitments.filter((c) => c.status !== "open");

  const meetings: Meeting[] = ((meetingsRes.data ?? []) as Meeting[]).map((m) => ({
    id: m.id,
    title: m.title,
    started_at: m.started_at,
    summary: m.summary,
  }));

  const recall: RecallHit[] = ((recallRes.data ?? []) as Array<{
    id: string;
    source: string;
    title: string | null;
    body: string;
    occurred_at: string;
  }>).map((r) => ({
    id: r.id,
    source: r.source,
    title: r.title,
    snippet: (r.body ?? "").slice(0, 240),
    occurred_at: r.occurred_at,
  }));

  const firstName =
    commitments.find((c) => c.other_party?.trim())?.other_party?.trim() ?? null;

  const reliability = computeReliability(commitments);

  const body: ContactProfile = {
    email,
    name: firstName,
    commitments: { open, closed },
    meetings,
    recall,
    reliability,
  };
  return NextResponse.json(body);
}

function computeReliability(commitments: Commitment[]): Reliability {
  const now = Date.now();
  const buckets = {
    outbound: { delivered: 0, lapsed: 0 },
    inbound: { delivered: 0, lapsed: 0 },
  };
  for (const c of commitments) {
    const b = c.direction === "outbound" ? buckets.outbound : buckets.inbound;
    if (c.status === "done") {
      b.delivered += 1;
      continue;
    }
    // Treat as lapsed if it's still open BUT deadline is >14d past — suggests
    // it quietly got forgotten. Open-with-future-deadline is neutral.
    if (c.status === "open" && c.deadline) {
      const ageMs = now - new Date(c.deadline).getTime();
      if (ageMs > 14 * 24 * 60 * 60 * 1000) b.lapsed += 1;
    }
  }
  const ratio = (d: number, l: number): number | null => {
    const total = d + l;
    if (total < 2) return null;
    return Number((d / total).toFixed(2));
  };
  return {
    outbound: { ...buckets.outbound, ratio: ratio(buckets.outbound.delivered, buckets.outbound.lapsed) },
    inbound: { ...buckets.inbound, ratio: ratio(buckets.inbound.delivered, buckets.inbound.lapsed) },
  };
}
