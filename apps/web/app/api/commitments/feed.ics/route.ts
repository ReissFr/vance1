// Public iCal feed of the user's open+overdue commitments with deadlines.
// Auth is via the opaque `?token=<token>` query param (profiles.ics_token) —
// calendar apps can't do cookie auth. Closed/cancelled commitments are
// excluded. Each commitment becomes a VEVENT on its deadline (all-day when
// the deadline is date-only, 30-min event when it has a time component).

import { type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function fold(line: string): string {
  // iCal lines should not exceed 75 octets; wrap by inserting CRLF + space.
  if (line.length <= 73) return line;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const chunk = line.slice(i, i === 0 ? 73 : i + 72);
    out.push(i === 0 ? chunk : ` ${chunk}`);
    i += chunk.length - (i === 0 ? 0 : 1);
    if (out.length > 1000) break; // defensive
  }
  return out.join("\r\n");
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toIcsDate(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function toIcsDateTime(d: Date): string {
  return (
    `${toIcsDate(d)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function isDateOnly(iso: string): boolean {
  // Deadlines stored as ISO sometimes have T00:00:00 — those are effectively
  // "the day" rather than midnight sharp. Treat midnight UTC as all-day.
  const m = iso.match(/T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return true;
  return m[1] === "00" && m[2] === "00" && m[3] === "00";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  if (!token || token.length < 16) {
    return new Response("unauthorized", { status: 401 });
  }

  const admin = supabaseAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, display_name")
    .eq("ics_token", token)
    .maybeSingle();
  if (!profile) {
    return new Response("unauthorized", { status: 401 });
  }
  const userId = profile.id as string;
  const owner = (profile.display_name as string | null) ?? "me";

  const { data: rows } = await admin
    .from("commitments")
    .select(
      "id, direction, other_party, commitment_text, deadline, status, updated_at",
    )
    .eq("user_id", userId)
    .in("status", ["open", "overdue"])
    .not("deadline", "is", null)
    .order("deadline", { ascending: true })
    .limit(500);

  const now = new Date();
  const dtstamp = toIcsDateTime(now);

  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//JARVIS//Commitments//EN");
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");
  lines.push(`X-WR-CALNAME:${esc(`JARVIS · ${owner}'s promises`)}`);
  lines.push(
    `X-WR-CALDESC:${esc("Open outbound + inbound commitments with deadlines. Auto-synced.")}`,
  );
  lines.push("X-WR-TIMEZONE:UTC");
  lines.push("REFRESH-INTERVAL;VALUE=DURATION:PT1H");

  for (const r of rows ?? []) {
    const deadline = r.deadline as string;
    const d = new Date(deadline);
    if (Number.isNaN(d.getTime())) continue;

    const allDay = isDateOnly(deadline);
    const direction = r.direction as string;
    const arrow = direction === "outbound" ? "→" : "←";
    const who = r.other_party as string;
    const text = r.commitment_text as string;
    const summary = `${arrow} ${who} · ${text}`;

    const uid = `commitment-${r.id}@jarvis`;
    const updated = r.updated_at ? new Date(r.updated_at as string) : now;
    const pastDue = d.getTime() < now.getTime();
    const descParts: string[] = [];
    descParts.push(direction === "outbound" ? `YOU OWE ${who}` : `${who} OWES YOU`);
    descParts.push(text);
    if (pastDue) descParts.push("⚠ overdue");
    const description = descParts.join("\\n");

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${toIcsDateTime(updated)}`);
    if (allDay) {
      lines.push(`DTSTART;VALUE=DATE:${toIcsDate(d)}`);
      // DTEND for all-day events is the day AFTER (exclusive end).
      const end = new Date(d.getTime() + 24 * 60 * 60 * 1000);
      lines.push(`DTEND;VALUE=DATE:${toIcsDate(end)}`);
    } else {
      lines.push(`DTSTART:${toIcsDateTime(d)}`);
      const end = new Date(d.getTime() + 30 * 60 * 1000);
      lines.push(`DTEND:${toIcsDateTime(end)}`);
    }
    lines.push(fold(`SUMMARY:${esc(summary)}`));
    lines.push(fold(`DESCRIPTION:${esc(description)}`));
    lines.push(
      `CATEGORIES:${direction === "outbound" ? "Outbound promise" : "Inbound promise"}`,
    );
    if (pastDue) lines.push("STATUS:CONFIRMED");
    lines.push("TRANSP:TRANSPARENT"); // don't block time in user's calendar
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n"), {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      // Keep it fresh — calendar apps cache aggressively by default.
      "cache-control": "private, no-store",
      "content-disposition": 'inline; filename="jarvis-commitments.ics"',
    },
  });
}
