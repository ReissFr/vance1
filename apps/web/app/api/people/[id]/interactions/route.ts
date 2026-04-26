// Interactions for a single person. GET returns chronological history. POST
// creates a new interaction and stamps people.last_interaction_at so the
// reconnect-suggestion logic always has a fresh signal.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_KINDS = new Set([
  "call",
  "meeting",
  "email",
  "dm",
  "whatsapp",
  "sms",
  "event",
  "intro",
  "other",
]);

const VALID_SENTIMENTS = new Set(["positive", "neutral", "negative"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("person_interactions")
    .select("id, kind, summary, sentiment, occurred_at, created_at")
    .eq("user_id", user.id)
    .eq("person_id", id)
    .order("occurred_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: personId } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const summary = typeof body.summary === "string" ? body.summary.trim().slice(0, 2000) : "";
  if (!summary) return NextResponse.json({ error: "summary required" }, { status: 400 });

  const kind =
    typeof body.kind === "string" && VALID_KINDS.has(body.kind) ? body.kind : "other";
  const sentiment =
    typeof body.sentiment === "string" && VALID_SENTIMENTS.has(body.sentiment)
      ? body.sentiment
      : null;

  let occurredAt = new Date().toISOString();
  if (typeof body.occurred_at === "string" && body.occurred_at.trim()) {
    const d = new Date(body.occurred_at);
    if (!Number.isNaN(d.getTime())) occurredAt = d.toISOString();
  }

  const { data: person } = await supabase
    .from("people")
    .select("id")
    .eq("id", personId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!person) return NextResponse.json({ error: "person not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("person_interactions")
    .insert({
      user_id: user.id,
      person_id: personId,
      kind,
      summary,
      sentiment,
      occurred_at: occurredAt,
    })
    .select("id, kind, summary, sentiment, occurred_at, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase
    .from("people")
    .update({ last_interaction_at: occurredAt, updated_at: new Date().toISOString() })
    .eq("id", personId)
    .eq("user_id", user.id);

  return NextResponse.json({ interaction: data });
}
