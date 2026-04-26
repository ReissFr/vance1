// CalendarProvider — capability interface for scheduling platforms
// (Cal.com today; Calendly pluggable). Distinct from raw calendar read/write
// (Google Calendar sits at a different layer piggybacking on Gmail OAuth) —
// this is scheduling-link / booking-page management.

export interface CalendarProvider {
  readonly providerName: string;

  /** List the scheduling links ("event types") the user owns. */
  listEventTypes(limit?: number): Promise<EventType[]>;

  /** List upcoming bookings. */
  listBookings(input: ListBookingsInput): Promise<Booking[]>;

  /** Get a single booking by id. */
  getBooking(id: string): Promise<Booking>;

  /** Cancel a booking (sends cancellation email via provider). */
  cancelBooking(id: string, reason?: string): Promise<void>;

  /** Get the public scheduling URL the user shares with people. */
  getSchedulingUrl(): Promise<string>;
}

export type EventType = {
  id: string;
  title: string;
  slug: string;
  length_minutes: number;
  description: string;
  url: string;
  hidden: boolean;
};

export type Booking = {
  id: string;
  title: string;
  event_type: string | null;
  start: string; // ISO
  end: string; // ISO
  status: "accepted" | "pending" | "cancelled" | "rejected" | string;
  attendees: Attendee[];
  location: string | null;
  description: string;
  url: string;
};

export type Attendee = {
  name: string;
  email: string;
  timezone: string | null;
};

export type ListBookingsInput = {
  status?: "upcoming" | "past" | "cancelled" | "recurring" | "unconfirmed";
  limit?: number;
};
