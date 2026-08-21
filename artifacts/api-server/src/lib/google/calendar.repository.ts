// Google Calendar I/O for appointment scheduling — the replacement for the old
// Notion availability + appointments repositories. Three functions the service
// calls:
//   - getScheduleConfig()      the positive weekly-hours grid (from config;
//                              time-off is empty because a day off is now just a
//                              busy calendar event, subtracted below).
//   - listBusyInRange()        each staff member's busy intervals from the Google
//                              FreeBusy API → Booking[] (booked appointments are
//                              themselves busy events, so they're included).
//   - createCalendarEvent()    writes the booking as a calendar event, invites
//                              the customer, and (for virtual) attaches a Meet.
//
// Plus the reads and writes the later features grew: get/update/cancel one event
// (self-service reschedule & cancel), list a customer's events by the `aptEmail`
// stamp (the account portal), and list a time window + stamp a reminder marker
// (the day-before reminder sweep).
//
// Busy is read fresh (no cache): availability and the final booking re-check
// must reflect the latest state so a just-taken slot is never offered.

import {
  getGoogleCalendarClient,
  type GoogleCalendarClient,
} from "./client.js";
import {
  calendarEmailFor,
  getStaffSchedule,
} from "../appointments/schedule.js";
import type { AppointmentLocation } from "../appointments/catalog.js";
import type {
  Booking,
  TimeOff,
  WeeklyHours,
} from "../appointments/availability.js";

export interface ScheduleConfig {
  weeklyHours: WeeklyHours[];
  timeOff: TimeOff[];
}

/**
 * The positive availability grid, read from the studio's working-hours
 * schedule (the "Staff Availability" Notion database).
 * Time-off lives on the staff calendars (subtracted as busy), so it's always [].
 */
export async function getScheduleConfig(): Promise<ScheduleConfig> {
  const { weeklyHours } = await getStaffSchedule();
  return { weeklyHours, timeOff: [] };
}

interface FreeBusyResponse {
  calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
}

/**
 * Busy intervals for the given staff over `[from, to)`, one FreeBusy call per
 * staff member (impersonating that person, querying their own calendar — no
 * assumption about cross-calendar free/busy visibility). Returned as `Booking[]`
 * so `computeSlots` subtracts them exactly as it did Notion bookings.
 */
export async function listBusyInRange(
  from: Date,
  to: Date,
  staffNames: string[],
  client: GoogleCalendarClient = getGoogleCalendarClient(),
): Promise<Booking[]> {
  const targets: Array<{ name: string; email: string }> = [];
  for (const name of staffNames) {
    const email = await calendarEmailFor(name);
    if (email) targets.push({ name, email });
  }

  const bookings: Booking[] = [];
  for (const target of targets) {
    const response = await client.fetch(target.email, "/freeBusy", {
      method: "POST",
      body: JSON.stringify({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: [{ id: target.email }],
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Google Calendar freeBusy failed with status ${response.status}`,
      );
    }

    const data = (await response.json()) as FreeBusyResponse;
    const busy = data.calendars?.[target.email]?.busy ?? [];
    for (const interval of busy) {
      bookings.push({
        staff: target.name,
        start: new Date(interval.start),
        end: new Date(interval.end),
      });
    }
  }
  return bookings;
}

/** A fully-resolved appointment to write to the calendar (times are instants). */
export interface BookedAppointment {
  customerName: string;
  email: string;
  phone?: string;
  /** The appointment type's id (stored on the event so a reschedule can
   * recompute availability for the same type). */
  typeId: string;
  typeName: string;
  staff: string;
  location: AppointmentLocation;
  /** Human location label, e.g. "In person". */
  locationLabel: string;
  start: Date;
  end: Date;
  /** IANA timezone the event's wall-clock is expressed in. */
  timeZone: string;
  confirmationCode: string;
  notes?: string;
  preferredContact?: string;
  /** The customer's order number, for order-scoped types (fittings, design
   * reviews). Recorded on the event so the atelier sees which order it's for. */
  orderNumber?: string;
  /** The customer's project description, for new-customer types (consultations,
   * general). Recorded on the event so the atelier can see the ask up front. */
  projectDetails?: string;
}

interface CalendarEventResponse {
  id?: string;
  htmlLink?: string;
  hangoutLink?: string;
}

/**
 * Private `extendedProperties` keys we stamp on each appointment event so it's a
 * self-describing record (there is no appointments database). A reschedule reads
 * `aptType`/`aptLocation` to recompute availability; the reschedule/cancel emails
 * read the customer fields. Kept short — Google caps each key at 44 chars and the
 * whole private map at 300 entries.
 */
export const EVENT_PROP_TYPE = "aptType";
export const EVENT_PROP_LOCATION = "aptLocation";
export const EVENT_PROP_CONFIRMATION = "aptConfirmation";
export const EVENT_PROP_EMAIL = "aptEmail";
export const EVENT_PROP_NAME = "aptName";
/**
 * The customer's phone number, stamped so a future channel has somewhere to send
 * to. Nothing reads it today — the reminder sweep below emails — but the number
 * is only on the event if it was written when the booking was made, and an SMS
 * reminder built later can't retro-fit it onto bookings already taken. Same
 * argument as `aptEmail`, which the account portal came to depend on.
 */
export const EVENT_PROP_PHONE = "aptPhone";
// The reminder markers (`aptRemindedEmail` / `aptRemindedSms`) are the one pair
// of appointment properties NOT declared here: they belong to the reminder
// policy, which is pure and shouldn't reach through this adapter to read its own
// vocabulary. `markAppointmentReminded` below takes the key as an argument for
// the same reason. See `lib/appointments/reminders.ts`.

/**
 * Write the booking to the staff member's calendar (impersonated), invite the
 * customer (`sendUpdates=all` → a real Google invite), and for a virtual
 * appointment request a Google Meet link. Returns the event id (the durable
 * handle for later reschedule/cancel) + the Meet link + the event's calendar URL
 * for the confirmation UI/email.
 */
export async function createCalendarEvent(
  appointment: BookedAppointment,
  title: string,
  client: GoogleCalendarClient = getGoogleCalendarClient(),
): Promise<{ eventId?: string; meetingUrl?: string; calendarLink?: string }> {
  const calendarEmail = await calendarEmailFor(appointment.staff);
  if (!calendarEmail) {
    throw new Error(
      `No calendar is configured for staff member "${appointment.staff}"`,
    );
  }

  const isVirtual = appointment.location === "virtual";

  const description = [
    `${appointment.typeName} booking`,
    `Customer: ${appointment.customerName}`,
    `Email: ${appointment.email}`,
    ...(appointment.phone ? [`Phone: ${appointment.phone}`] : []),
    ...(appointment.preferredContact
      ? [`Preferred contact: ${appointment.preferredContact}`]
      : []),
    ...(appointment.orderNumber ? [`Order: ${appointment.orderNumber}`] : []),
    `Confirmation: ${appointment.confirmationCode}`,
    ...(appointment.projectDetails
      ? ["", `Project: ${appointment.projectDetails}`]
      : []),
    ...(appointment.notes ? ["", `Notes: ${appointment.notes}`] : []),
  ].join("\n");

  const body: Record<string, unknown> = {
    summary: title,
    description,
    location: isVirtual ? "Google Meet" : appointment.locationLabel,
    start: {
      dateTime: appointment.start.toISOString(),
      timeZone: appointment.timeZone,
    },
    end: {
      dateTime: appointment.end.toISOString(),
      timeZone: appointment.timeZone,
    },
    attendees: [
      { email: appointment.email, displayName: appointment.customerName },
    ],
    extendedProperties: {
      private: {
        [EVENT_PROP_TYPE]: appointment.typeId,
        [EVENT_PROP_LOCATION]: appointment.location,
        [EVENT_PROP_CONFIRMATION]: appointment.confirmationCode,
        [EVENT_PROP_EMAIL]: appointment.email,
        [EVENT_PROP_NAME]: appointment.customerName,
        ...(appointment.phone ? { [EVENT_PROP_PHONE]: appointment.phone } : {}),
      },
    },
    ...(isVirtual
      ? {
          conferenceData: {
            createRequest: {
              requestId: appointment.confirmationCode,
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        }
      : {}),
  };

  const query = new URLSearchParams({
    sendUpdates: "all",
    conferenceDataVersion: "1",
  });
  const response = await client.fetch(
    calendarEmail,
    `/calendars/${encodeURIComponent(calendarEmail)}/events?${query}`,
    { method: "POST", body: JSON.stringify(body) },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Google Calendar event insert failed with status ${response.status}: ${errorText}`,
    );
  }

  const event = (await response.json()) as CalendarEventResponse;
  return {
    eventId: event.id,
    meetingUrl: event.hangoutLink,
    calendarLink: event.htmlLink,
  };
}

/** A booked appointment read back from the calendar (times are instants). */
export interface CalendarEventDetails {
  id: string;
  /** Google's event status — "confirmed" | "tentative" | "cancelled". */
  status: string;
  start: Date;
  end: Date;
  meetingUrl?: string;
  calendarLink?: string;
  /** The event's private `extendedProperties` (our appointment metadata). */
  extended: Record<string, string>;
}

interface CalendarEventGetResponse extends CalendarEventResponse {
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

interface CalendarEventsListResponse {
  items?: CalendarEventGetResponse[];
}

/** Map a raw Google event to our `CalendarEventDetails` (shared by the single-get
 * and the list-by-email paths). */
function parseCalendarEvent(
  event: CalendarEventGetResponse,
  fallbackId = "",
): CalendarEventDetails {
  const startIso = event.start?.dateTime ?? event.start?.date;
  const endIso = event.end?.dateTime ?? event.end?.date;
  return {
    id: event.id ?? fallbackId,
    status: event.status ?? "confirmed",
    start: startIso ? new Date(startIso) : new Date(NaN),
    end: endIso ? new Date(endIso) : new Date(NaN),
    ...(event.hangoutLink ? { meetingUrl: event.hangoutLink } : {}),
    ...(event.htmlLink ? { calendarLink: event.htmlLink } : {}),
    extended: event.extendedProperties?.private ?? {},
  };
}

/**
 * Read one appointment event back from the staff member's calendar. Returns null
 * when the event no longer exists (deleted → 404/410, e.g. cancelled via the
 * flow below); a `status === "cancelled"` event is still returned so callers can
 * surface a friendly "already cancelled" state.
 */
export async function getCalendarEvent(
  staff: string,
  eventId: string,
  client: GoogleCalendarClient = getGoogleCalendarClient(),
): Promise<CalendarEventDetails | null> {
  const calendarEmail = await calendarEmailFor(staff);
  if (!calendarEmail) {
    throw new Error(`No calendar is configured for staff member "${staff}"`);
  }

  const response = await client.fetch(
    calendarEmail,
    `/calendars/${encodeURIComponent(calendarEmail)}/events/${encodeURIComponent(eventId)}`,
    { method: "GET" },
  );
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) {
    throw new Error(
      `Google Calendar event get failed with status ${response.status}`,
    );
  }

  const event = (await response.json()) as CalendarEventGetResponse;
  return parseCalendarEvent(event, eventId);
}

/** A booked appointment read off a staff calendar, paired with whose calendar it
 * lives on (the durable `staff` handle a reschedule/cancel needs). */
export interface StaffCalendarEvent {
  staff: string;
  event: CalendarEventDetails;
}

/**
 * List a customer's upcoming appointment events across every staff calendar,
 * found by the `aptEmail` private extended property stamped on each booking at
 * creation. One `events.list` per staff calendar (impersonating that calendar,
 * same model as `listBusyInRange`), filtered server-side to our events for this
 * email from now forward and expanded to single instances. Bookings made before
 * the `aptEmail` stamp existed won't match (the account portal notes this). The
 * caller maps each event to a DTO and skips any whose type is unrecognizable.
 */
export async function listUpcomingAppointmentsByEmail(
  email: string,
  client: GoogleCalendarClient = getGoogleCalendarClient(),
): Promise<StaffCalendarEvent[]> {
  const trimmed = email.trim();
  if (!trimmed) return [];

  const { calendars } = await getStaffSchedule();
  const timeMin = new Date().toISOString();
  const found: StaffCalendarEvent[] = [];

  for (const [staff, calendarEmail] of calendars) {
    const query = new URLSearchParams({
      privateExtendedProperty: `${EVENT_PROP_EMAIL}=${trimmed}`,
      timeMin,
      singleEvents: "true",
      orderBy: "startTime",
      showDeleted: "false",
    });
    const response = await client.fetch(
      calendarEmail,
      `/calendars/${encodeURIComponent(calendarEmail)}/events?${query}`,
      { method: "GET" },
    );
    if (!response.ok) {
      throw new Error(
        `Google Calendar events list failed with status ${response.status}`,
      );
    }
    const data = (await response.json()) as CalendarEventsListResponse;
    for (const item of data.items ?? []) {
      found.push({ staff, event: parseCalendarEvent(item) });
    }
  }

  found.sort((a, b) => a.event.start.getTime() - b.event.start.getTime());
  return found;
}

/**
 * Every appointment event starting inside `[from, to)`, across every staff
 * calendar — the read the day-before reminder sweep is built on.
 *
 * Unlike `listUpcomingAppointmentsByEmail` this can't push the "is it ours?" test
 * into the query: `privateExtendedProperty` matches one exact `key=value` pair
 * and repeating the parameter ANDs the pairs, so there is no way to ask for "any
 * `aptType`". So it lists the window plainly and filters here on the `aptEmail`
 * stamp, which every booking this app made carries. A day's worth of a small
 * atelier's calendar is a handful of events, and the alternative — one query per
 * appointment type per calendar — is more requests for the same answer.
 */
export async function listAppointmentsInRange(
  from: Date,
  to: Date,
  client: GoogleCalendarClient = getGoogleCalendarClient(),
): Promise<StaffCalendarEvent[]> {
  const { calendars } = await getStaffSchedule();
  const found: StaffCalendarEvent[] = [];

  for (const [staff, calendarEmail] of calendars) {
    const query = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      showDeleted: "false",
    });
    const response = await client.fetch(
      calendarEmail,
      `/calendars/${encodeURIComponent(calendarEmail)}/events?${query}`,
      { method: "GET" },
    );
    if (!response.ok) {
      throw new Error(
        `Google Calendar events list failed with status ${response.status}`,
      );
    }
    const data = (await response.json()) as CalendarEventsListResponse;
    for (const item of data.items ?? []) {
      const event = parseCalendarEvent(item);
      // Ours, not the staff member's lunch or a personal entry.
      if (event.extended[EVENT_PROP_EMAIL]) found.push({ staff, event });
    }
  }

  found.sort((a, b) => a.event.start.getTime() - b.event.start.getTime());
  return found;
}

/**
 * Record on the event itself that a reminder went out for it, on one channel.
 *
 * The whole `private` map is rewritten from the copy the caller just read, plus
 * the marker: patch semantics on a nested map aren't a merge we want to bet an
 * event's metadata on, and re-sending what we read is both cheap and exact.
 * `sendUpdates=none` because this is bookkeeping — the customer must not get a
 * second calendar notification for a reminder we sent them.
 */
export async function markAppointmentReminded(
  staff: string,
  eventId: string,
  existing: Record<string, string>,
  marker: { key: string; value: string },
  client: GoogleCalendarClient = getGoogleCalendarClient(),
): Promise<void> {
  const calendarEmail = await calendarEmailFor(staff);
  if (!calendarEmail) {
    throw new Error(`No calendar is configured for staff member "${staff}"`);
  }

  const body = {
    extendedProperties: {
      private: { ...existing, [marker.key]: marker.value },
    },
  };
  const query = new URLSearchParams({ sendUpdates: "none" });
  const response = await client.fetch(
    calendarEmail,
    `/calendars/${encodeURIComponent(calendarEmail)}/events/${encodeURIComponent(eventId)}?${query}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
  if (!response.ok) {
    throw new Error(
      `Google Calendar reminder marker patch failed with status ${response.status}`,
    );
  }
}

/**
 * Move an appointment event to a new time (a PATCH is a merge, so attendees,
 * description, Meet link, and extended properties are left intact). `sendUpdates`
 * re-notifies the customer of the new time. Returns the (unchanged) Meet +
 * calendar links.
 */
export async function updateCalendarEvent(
  staff: string,
  eventId: string,
  when: { start: Date; end: Date; timeZone: string },
  client: GoogleCalendarClient = getGoogleCalendarClient(),
): Promise<{ meetingUrl?: string; calendarLink?: string }> {
  const calendarEmail = await calendarEmailFor(staff);
  if (!calendarEmail) {
    throw new Error(`No calendar is configured for staff member "${staff}"`);
  }

  const body = {
    start: { dateTime: when.start.toISOString(), timeZone: when.timeZone },
    end: { dateTime: when.end.toISOString(), timeZone: when.timeZone },
  };
  const query = new URLSearchParams({ sendUpdates: "all" });
  const response = await client.fetch(
    calendarEmail,
    `/calendars/${encodeURIComponent(calendarEmail)}/events/${encodeURIComponent(eventId)}?${query}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Google Calendar event patch failed with status ${response.status}: ${errorText}`,
    );
  }

  const event = (await response.json()) as CalendarEventResponse;
  return { meetingUrl: event.hangoutLink, calendarLink: event.htmlLink };
}

/**
 * Delete an appointment event, cancelling the customer's invite (`sendUpdates`)
 * and freeing the slot (a deleted event is no longer busy). Idempotent — a 404 /
 * 410 (already gone) is treated as success.
 */
export async function cancelCalendarEvent(
  staff: string,
  eventId: string,
  client: GoogleCalendarClient = getGoogleCalendarClient(),
): Promise<void> {
  const calendarEmail = await calendarEmailFor(staff);
  if (!calendarEmail) {
    throw new Error(`No calendar is configured for staff member "${staff}"`);
  }

  const query = new URLSearchParams({ sendUpdates: "all" });
  const response = await client.fetch(
    calendarEmail,
    `/calendars/${encodeURIComponent(calendarEmail)}/events/${encodeURIComponent(eventId)}?${query}`,
    { method: "DELETE" },
  );
  if (response.status === 404 || response.status === 410) return;
  if (!response.ok) {
    throw new Error(
      `Google Calendar event delete failed with status ${response.status}`,
    );
  }
}
