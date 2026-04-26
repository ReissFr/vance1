// Calendar-event prep brief. Given a Google Calendar event ID, returns the
// context JARVIS would hand a chief-of-staff: who the attendees are, relevant
// prior interactions (emails + meetings) from recall, and open commitments
// with those counterparties.
//
// Called by the PREP button on /today's calendar card and by the proactive
// loop's 15-min-before pre-meeting ping (via buildEventPrep in lib/calendar-prep).

import { NextResponse, type NextRequest } from "next/server";
import { google } from "googleapis";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import {
  buildEventPrep,
  type EventPrep,
  type PrepEventInput,
} from "@/lib/calendar-prep";

export const runtime = "nodejs";

type PrepResponse = {
  event:
    | (PrepEventInput & {
        start: string | null;
        description: string | null;
        location: string | null;
      })
    | null;
  related: EventPrep["related"];
  commitments: EventPrep["commitments"];
};

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const eventId = searchParams.get("event_id");
  if (!eventId) {
    return NextResponse.json({ error: "event_id required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("google_access_token")
    .eq("id", user.id)
    .maybeSingle();
  const accessToken = (profile?.google_access_token as string | undefined) ?? null;
  if (!accessToken) {
    return NextResponse.json({ error: "google not connected" }, { status: 400 });
  }

  const event = await fetchEvent(accessToken, eventId);
  if (!event) {
    return NextResponse.json({ error: "event not found" }, { status: 404 });
  }

  const prep = await buildEventPrep(admin, user.id, {
    id: event.id,
    summary: event.summary,
    attendees: event.attendees,
  });

  const body: PrepResponse = {
    event,
    related: prep.related,
    commitments: prep.commitments,
  };
  return NextResponse.json(body);
}

async function fetchEvent(
  accessToken: string,
  eventId: string,
): Promise<PrepResponse["event"]> {
  try {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const cal = google.calendar({ version: "v3", auth });
    const res = await cal.events.get({ calendarId: "primary", eventId });
    const e = res.data;
    return {
      id: e.id ?? eventId,
      summary: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? null,
      attendees: (e.attendees ?? [])
        .map((a) => a.email)
        .filter((x): x is string => Boolean(x)),
      description: e.description ?? null,
      location: e.location ?? null,
    };
  } catch {
    return null;
  }
}
