// Appointment scheduling use-cases, independent of HTTP. Route handlers call
// these with already-validated input and turn the result (or thrown domain
// errors) into a response.
//
// The booking flow never trusts the client: it re-derives the type/duration/
// staff from the code catalog and re-runs the exact same slot computation the
// availability endpoint uses before writing, so a stale or forged slot can't be
// booked. The same `computeSlots` powers both, so the two can't disagree.

import type { z } from "zod";
import type {
  GetAppointmentAvailabilityQueryParams,
  CreateAppointmentBody,
} from "@workspace/api-zod";
import {
  APPOINTMENT_TYPES,
  LOCATION_LABELS,
  getAppointmentType,
  isAppointmentLocation,
  type AppointmentLocation,
} from "../lib/appointments/catalog.js";
import { computeSlots } from "../lib/appointments/availability.js";
import {
  addCalendarDays,
  dateInZone,
  formatInZone,
  zonedWallClockToInstant,
} from "../lib/appointments/time.js";
import {
  appointmentTimezone,
  maxAdvanceDays,
  minLeadMinutes,
  slotStepMinutes,
} from "../lib/appointments/settings.js";
import {
  getScheduleConfig,
  listBusyInRange,
  createCalendarEvent,
  type BookedAppointment,
} from "../lib/google/calendar.repository.js";
import {
  appointmentConfirmationEmail,
  appointmentNotificationEmail,
  type AppointmentEmailDetails,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";
import { BadRequestError } from "../lib/errors.js";

const DEFAULT_WINDOW_DAYS = 14;

type AvailabilityParams = z.infer<typeof GetAppointmentAvailabilityQueryParams>;
type BookInput = z.infer<typeof CreateAppointmentBody>;

interface OptionsResult {
  timezone: string;
  types: Array<{
    id: string;
    name: string;
    durationMinutes: number;
    description: string;
    staff: string[];
    locations: AppointmentLocation[];
  }>;
}

/** The bookable type catalog + booking timezone (no I/O). */
export function getAppointmentOptions(): OptionsResult {
  return {
    timezone: appointmentTimezone(),
    types: APPOINTMENT_TYPES.map((type) => ({
      id: type.id,
      name: type.name,
      durationMinutes: type.durationMinutes,
      description: type.description,
      staff: type.staff,
      locations: type.locations,
    })),
  };
}

interface SlotResult {
  timezone: string;
  slots: Array<{ start: Date; end: Date; staff: string }>;
}

/** Open slots for a type + location (+ optional staff) over a date window. */
export async function getAppointmentAvailability(
  params: AvailabilityParams,
): Promise<SlotResult> {
  const type = getAppointmentType(params.typeId);
  if (!type) {
    throw new BadRequestError("We don't recognize that appointment type.");
  }
  const location = params.location as AppointmentLocation;
  if (!type.locations.includes(location)) {
    throw new BadRequestError(
      "That appointment type isn't offered at that location.",
    );
  }
  if (params.staff && !type.staff.includes(params.staff)) {
    throw new BadRequestError(
      "That staff member doesn't offer this appointment type.",
    );
  }

  const timeZone = appointmentTimezone();
  const now = new Date();
  const fromDate = params.from ?? dateInZone(now, timeZone);
  const days = Math.min(params.days ?? DEFAULT_WINDOW_DAYS, maxAdvanceDays());

  const rangeStart = zonedWallClockToInstant(fromDate, 0, timeZone);
  const rangeEnd = zonedWallClockToInstant(
    addCalendarDays(fromDate, days),
    0,
    timeZone,
  );

  const eligibleStaff = type.staff.filter(
    (member) => !params.staff || member === params.staff,
  );
  const { weeklyHours, timeOff } = await getScheduleConfig();
  const bookings = await listBusyInRange(rangeStart, rangeEnd, eligibleStaff);

  const slots = computeSlots({
    type,
    location,
    staffFilter: params.staff,
    fromDate,
    days,
    now,
    timeZone,
    minLeadMinutes: minLeadMinutes(),
    slotStepMinutes: slotStepMinutes(),
    weeklyHours,
    timeOff,
    bookings,
  });

  return {
    timezone: timeZone,
    slots: slots.map((slot) => ({
      start: slot.start,
      end: slot.end,
      staff: slot.staff,
    })),
  };
}

function generateConfirmationCode(): string {
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  return `APT-${stamp}${random}`;
}

interface BookResult {
  confirmationCode: string;
  type: string;
  staff: string;
  location: string;
  start: Date;
  end: Date;
  meetingUrl?: string;
  calendarLink?: string;
}

/** Book a slot: re-validate, re-check availability, persist, and email. */
export async function bookAppointment(input: BookInput): Promise<BookResult> {
  const type = getAppointmentType(input.typeId);
  if (!type) {
    throw new BadRequestError("We don't recognize that appointment type.");
  }
  if (!isAppointmentLocation(input.location)) {
    throw new BadRequestError("We don't recognize that location.");
  }
  const location = input.location;
  if (!type.locations.includes(location)) {
    throw new BadRequestError(
      "That appointment type isn't offered at that location.",
    );
  }
  if (input.staff && !type.staff.includes(input.staff)) {
    throw new BadRequestError(
      "That staff member doesn't offer this appointment type.",
    );
  }

  const start = input.start;
  if (Number.isNaN(start.getTime())) {
    throw new BadRequestError("That appointment time isn't valid.");
  }

  const timeZone = appointmentTimezone();
  const now = new Date();
  const dateStr = dateInZone(start, timeZone);

  const rangeStart = zonedWallClockToInstant(dateStr, 0, timeZone);
  const rangeEnd = zonedWallClockToInstant(
    addCalendarDays(dateStr, 1),
    0,
    timeZone,
  );

  const eligibleStaff = type.staff.filter(
    (member) => !input.staff || member === input.staff,
  );
  const { weeklyHours, timeOff } = await getScheduleConfig();
  const bookings = await listBusyInRange(rangeStart, rangeEnd, eligibleStaff);

  const slots = computeSlots({
    type,
    location,
    staffFilter: input.staff,
    fromDate: dateStr,
    days: 1,
    now,
    timeZone,
    minLeadMinutes: minLeadMinutes(),
    slotStepMinutes: slotStepMinutes(),
    weeklyHours,
    timeOff,
    bookings,
  });

  const match = slots.find((slot) => slot.start.getTime() === start.getTime());
  if (!match) {
    throw new BadRequestError(
      "That time is no longer available. Please choose another.",
    );
  }

  const staff = match.staff;
  const end = match.end;
  const confirmationCode = generateConfirmationCode();
  const locationLabel = LOCATION_LABELS[location];
  const when = formatInZone(start, timeZone);
  const title = `${type.name} — ${input.fullName} — ${when}`;

  const appointment: BookedAppointment = {
    customerName: input.fullName,
    email: input.email,
    phone: input.phone,
    typeName: type.name,
    staff,
    location,
    locationLabel,
    start,
    end,
    timeZone,
    confirmationCode,
    notes: input.notes,
    preferredContact: input.preferredContact,
  };
  const { meetingUrl, calendarLink } = await createCalendarEvent(
    appointment,
    title,
  );

  // Best-effort emails; a mail failure must not fail the booking.
  const details: AppointmentEmailDetails = {
    customerName: input.fullName,
    email: input.email,
    phone: input.phone,
    typeName: type.name,
    staff,
    locationLabel,
    when,
    confirmationCode,
    notes: input.notes,
    meetingUrl,
  };
  const from = fromAddress("appointments");
  await sendEmailBestEffort({ ...appointmentConfirmationEmail(details), from });
  const inbox = atelierInbox("appointments");
  if (inbox) {
    await sendEmailBestEffort({
      ...appointmentNotificationEmail(details, inbox),
      from,
    });
  }

  return {
    confirmationCode,
    type: type.name,
    staff,
    location: locationLabel,
    start,
    end,
    ...(meetingUrl ? { meetingUrl } : {}),
    ...(calendarLink ? { calendarLink } : {}),
  };
}
