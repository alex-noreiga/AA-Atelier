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
  htmlLink?: string;
  hangoutLink?: string;
}

/**
 * Write the booking to the staff member's calendar (impersonated), invite the
 * customer (`sendUpdates=all` → a real Google invite), and for a virtual
 * appointment request a Google Meet link. Returns the Meet link + the event's
 * calendar URL for the confirmation UI/email.
 */
export async function createCalendarEvent(
  appointment: BookedAppointment,
  title: string,
  client: GoogleCalendarClient = getGoogleCalendarClient(),
): Promise<{ meetingUrl?: string; calendarLink?: string }> {
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
  return { meetingUrl: event.hangoutLink, calendarLink: event.htmlLink };
}
