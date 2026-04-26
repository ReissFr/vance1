// Brain-level Cal.com tools via the CalendarProvider resolver.

import { z } from "zod";
import { getCalendarProvider } from "@jarvis/integrations";
import { defineTool } from "./types";

const PROVIDERS = ["calcom"] as const;

export const calcomEventTypesTool = defineTool({
  name: "calcom_event_types",
  description:
    "List the user's Cal.com event types (their scheduling links). Returns title, duration, description, and shareable URL for each.",
  schema: z.object({
    limit: z.number().int().min(1).max(100).optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max, 1–100. Default 20." },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
  },
  async run(input, ctx) {
    const cal = await getCalendarProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: cal.providerName,
      event_types: await cal.listEventTypes(input.limit ?? 20),
    };
  },
});

export const calcomBookingsTool = defineTool({
  name: "calcom_bookings",
  description:
    "List Cal.com bookings. Default is upcoming. Use status='past' for history, 'cancelled' for cancellations, 'unconfirmed' for pending approvals.",
  schema: z.object({
    status: z
      .enum(["upcoming", "past", "cancelled", "recurring", "unconfirmed"])
      .optional(),
    limit: z.number().int().min(1).max(200).optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["upcoming", "past", "cancelled", "recurring", "unconfirmed"],
      },
      limit: { type: "number" },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
  },
  async run(input, ctx) {
    const cal = await getCalendarProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: cal.providerName,
      bookings: await cal.listBookings({
        status: input.status ?? "upcoming",
        limit: input.limit,
      }),
    };
  },
});

export const calcomCancelBookingTool = defineTool({
  name: "calcom_cancel_booking",
  description:
    "Cancel a Cal.com booking by id. The attendee is notified by email automatically. Destructive — only call when explicitly asked to cancel.",
  schema: z.object({
    booking_id: z.string().min(1),
    reason: z.string().optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      booking_id: { type: "string" },
      reason: { type: "string", description: "Optional cancellation reason shown to the attendee." },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["booking_id"],
  },
  async run(input, ctx) {
    const cal = await getCalendarProvider(ctx.supabase, ctx.userId, input.provider);
    await cal.cancelBooking(input.booking_id, input.reason);
    return { ok: true };
  },
});

export const calcomSchedulingUrlTool = defineTool({
  name: "calcom_scheduling_url",
  description:
    "Return the user's public Cal.com scheduling URL (e.g. cal.com/username). Use when someone asks 'share my calendar link'.",
  schema: z.object({
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      provider: { type: "string", enum: [...PROVIDERS] },
    },
  },
  async run(input, ctx) {
    const cal = await getCalendarProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: cal.providerName,
      url: await cal.getSchedulingUrl(),
    };
  },
});
