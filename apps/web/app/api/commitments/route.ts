// List + manually add commitments.
//
// Automatic extraction (email sweep, meeting ghost) happens server-side; this
// POST is the "I just promised this, track it" path — a row that was never in
// an email or transcript.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const direction = searchParams.get("direction"); // outbound|inbound|all
  const status = searchParams.get("status"); // open|done|overdue|cancelled|all
  const limit = Math.min(Number(searchParams.get("limit") ?? 200), 500);

  let q = supabase
    .from("commitments")
    .select(
      "id, direction, other_party, other_party_email, commitment_text, deadline, status, source_email_id, source_email_subject, source_kind, source_meeting_id, source_meeting_title, confidence, user_confirmed, notes, created_at, updated_at",
    )
    .eq("user_id", user.id)
    .order("deadline", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (direction && direction !== "all") q = q.eq("direction", direction);
  if (status && status !== "all") q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Roll up overdue status in-response so we don't need a cron marking rows.
  const nowIso = new Date().toISOString();
  const rows = (data ?? []).map((r) => {
    if (
      r.status === "open" &&
      r.deadline &&
      (r.deadline as string) < nowIso
    ) {
      return { ...r, status: "overdue" as const };
    }
    return r;
  });

  return NextResponse.json({ commitments: rows });
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const direction = body.direction as string | undefined;
  if (direction !== "outbound" && direction !== "inbound") {
    return NextResponse.json(
      { error: "direction must be outbound or inbound" },
      { status: 400 },
    );
  }

  const other_party = typeof body.other_party === "string" ? body.other_party.trim() : "";
  const commitment_text =
    typeof body.commitment_text === "string" ? body.commitment_text.trim() : "";
  if (!other_party) {
    return NextResponse.json({ error: "other_party required" }, { status: 400 });
  }
  if (!commitment_text) {
    return NextResponse.json({ error: "commitment_text required" }, { status: 400 });
  }

  const other_party_email =
    typeof body.other_party_email === "string" && body.other_party_email.trim()
      ? body.other_party_email.trim().toLowerCase()
      : null;

  const deadlineRaw = body.deadline;
  let deadline: string | null = null;
  if (typeof deadlineRaw === "string" && deadlineRaw.trim()) {
    const d = new Date(deadlineRaw);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "invalid deadline" }, { status: 400 });
    }
    deadline = d.toISOString();
  }

  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;

  const dedup_key = `${direction}|${other_party.toLowerCase()}|${commitment_text.toLowerCase().slice(0, 80)}`;

  // If one already exists with this dedup_key, return it (idempotent).
  const { data: existing } = await supabase
    .from("commitments")
    .select(
      "id, direction, other_party, other_party_email, commitment_text, deadline, status, source_email_id, source_email_subject, source_kind, source_meeting_id, source_meeting_title, confidence, user_confirmed, notes, created_at, updated_at",
    )
    .eq("user_id", user.id)
    .eq("dedup_key", dedup_key)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ commitment: existing, created: false });
  }

  const { data: inserted, error } = await supabase
    .from("commitments")
    .insert({
      user_id: user.id,
      direction,
      other_party,
      other_party_email,
      commitment_text,
      dedup_key,
      deadline,
      status: "open",
      confidence: 1, // user-entered
      user_confirmed: true,
      notes,
      source_kind: "manual",
    })
    .select(
      "id, direction, other_party, other_party_email, commitment_text, deadline, status, source_email_id, source_email_subject, source_kind, source_meeting_id, source_meeting_title, confidence, user_confirmed, notes, created_at, updated_at",
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ commitment: inserted, created: true });
}
