import { google, type calendar_v3 } from "googleapis";
import { z } from "zod";
import { defineTool } from "./types";

function calClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth });
}

export const listCalendarTool = defineTool({
  name: "list_calendar_events",
  description: "List calendar events between two ISO datetimes.",
  schema: z.object({
    from: z.string(),
    to: z.string(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "ISO datetime, inclusive." },
      to: { type: "string", description: "ISO datetime, exclusive." },
    },
    required: ["from", "to"],
  },
  async run(input, ctx) {
    if (!ctx.googleAccessToken) throw new Error("Google account not connected");
    const cal = calClient(ctx.googleAccessToken);
    const res = await cal.events.list({
      calendarId: "primary",
      timeMin: input.from,
      timeMax: input.to,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    });
    return (res.data.items ?? []).map((e) => ({
      id: e.id,
      summary: e.summary,
      start: e.start?.dateTime ?? e.start?.date,
      end: e.end?.dateTime ?? e.end?.date,
      attendees: e.attendees?.map((a) => a.email).filter(Boolean),
      location: e.location ?? null,
    }));
  },
});

export const createCalendarTool = defineTool({
  name: "create_calendar_event",
  description:
    "Create a calendar event on the user's primary calendar. Always confirm start/end times with the user before calling.",
  schema: z.object({
    summary: z.string(),
    start_iso: z.string(),
    end_iso: z.string(),
    description: z.string().optional(),
    attendees: z.array(z.string().email()).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Event title." },
      start_iso: { type: "string", description: "ISO datetime with timezone." },
      end_iso: { type: "string", description: "ISO datetime with timezone." },
      description: { type: "string" },
      attendees: { type: "array", items: { type: "string" } },
    },
    required: ["summary", "start_iso", "end_iso"],
  },
  async run(input, ctx) {
    if (!ctx.googleAccessToken) throw new Error("Google account not connected");
    const cal = calClient(ctx.googleAccessToken);
    const requestBody: calendar_v3.Schema$Event = {
      summary: input.summary,
      start: { dateTime: input.start_iso },
      end: { dateTime: input.end_iso },
    };
    if (input.description) requestBody.description = input.description;
    if (input.attendees) requestBody.attendees = input.attendees.map((email) => ({ email }));

    const res = await cal.events.insert({
      calendarId: "primary",
      requestBody,
      sendUpdates: "all",
    });
    return { id: res.data.id, html_link: res.data.htmlLink };
  },
});
