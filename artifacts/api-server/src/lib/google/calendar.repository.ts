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
// Busy is read fresh (no cache): availability and the final booking re-check
// must reflect the latest state so a just-taken slot is never offered.

import {
  getGoogleCalendarClient,
  type GoogleCalendarClient,
} from "./client.js";
import { calendarEmailFor, getStaffSchedule } from "./sheets.repository.js";
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
 * The positive availability grid, read from the working-hours Google Sheet.
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
    `Confirmation: ${appointment.confirmationCode}`,
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
  const startIso = event.start?.dateTime ?? event.start?.date;
  const endIso = event.end?.dateTime ?? event.end?.date;
  return {
    id: event.id ?? eventId,
    status: event.status ?? "confirmed",
    start: startIso ? new Date(startIso) : new Date(NaN),
    end: endIso ? new Date(endIso) : new Date(NaN),
    ...(event.hangoutLink ? { meetingUrl: event.hangoutLink } : {}),
    ...(event.htmlLink ? { calendarLink: event.htmlLink } : {}),
    extended: event.extendedProperties?.private ?? {},
  };
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
