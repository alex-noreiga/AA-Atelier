// Self-service reschedule / cancel for a booked appointment, independent of
// HTTP. There is no appointments database — a booking exists only as an event on
// the staff member's Google Calendar — so the durable handle is the event id,
// carried (with the staff calendar + customer email) inside a signed token that
// the confirmation email embeds in a "manage your appointment" link. Possession
// of the signed link is the authorization, exactly like the account portal's
// magic link.
//
// Every action re-reads the event live from Google (never trusting the token's
// copy of anything but the ids), and a reschedule re-runs the same `computeSlots`
// the booking flow uses, so a stale or forged slot can't be booked. Emails are
// best-effort, matching the rest of the appointment flow.

import {
  verifyToken,
  signToken,
  authConfigured,
  APPOINTMENT_MANAGE_TTL_SECONDS,
} from "../lib/auth/tokens.js";
import {
  getAppointmentType,
  isAppointmentLocation,
  LOCATION_LABELS,
  type AppointmentLocation,
  type AppointmentTypeDef,
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
  minLeadMinutes,
  slotStepMinutes,
} from "../lib/appointments/settings.js";
import {
  getScheduleConfig,
  listBusyInRange,
  getCalendarEvent,
  updateCalendarEvent,
  cancelCalendarEvent,
  EVENT_PROP_TYPE,
  EVENT_PROP_LOCATION,
  EVENT_PROP_CONFIRMATION,
  EVENT_PROP_EMAIL,
  EVENT_PROP_NAME,
  type CalendarEventDetails,
} from "../lib/google/calendar.repository.js";
import {
  appointmentRescheduledEmail,
  appointmentCancelledEmail,
  appointmentChangeNotificationEmail,
  type AppointmentEmailDetails,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from "../lib/errors.js";

/** The public origin the manage link points back at (also used for the Stripe
 * redirect + the magic link). Empty when unset. */
function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
}

/**
 * Build the customer-facing "manage your appointment" URL for a booking, or
 * undefined when the feature isn't fully configured (no signing secret, or no
 * public base URL) — in which case the confirmation email falls back to its
 * "reply to us" copy. Called by the booking flow right after the event is
 * created, so it has the fresh event id.
 */
export function buildManageUrl(
  email: string,
  eventId: string,
  staff: string,
): string | undefined {
  if (!authConfigured()) return undefined;
  const base = publicBaseUrl();
  if (!base) return undefined;
  const token = signToken(
    email,
    "appointment",
    APPOINTMENT_MANAGE_TTL_SECONDS,
    {
      eventId,
      staff,
    },
  );
  return `${base}/appointments/manage?token=${encodeURIComponent(token)}`;
}

/** The appointment's current state, shaped for the `AppointmentDetails` contract. */
export interface AppointmentManageDetails {
  status: "confirmed" | "cancelled";
  confirmationCode: string;
  typeId: string;
  typeName: string;
  staff: string;
  location: AppointmentLocation;
  locationLabel: string;
  start: Date;
  end: Date;
  timezone: string;
  meetingUrl?: string;
  canModify: boolean;
}

/** Resolved handle from a valid manage token. */
interface ManageHandle {
  email: string;
  eventId: string;
  staff: string;
}

/** Verify + destructure a manage token, or throw a 400. */
function resolveToken(token: string): ManageHandle {
  const verified = verifyToken(token, "appointment");
  if (!verified || !verified.eventId || !verified.staff) {
    throw new BadRequestError(
      "This link is invalid or has expired. Please contact us to change your appointment.",
    );
  }
  return {
    email: verified.email,
    eventId: verified.eventId,
    staff: verified.staff,
  };
}

/** The catalog type an event was booked as, or a 400 if it's unrecognizable
 * (e.g. a legacy event missing our extended properties). */
function typeFromEvent(event: CalendarEventDetails): AppointmentTypeDef {
  const typeId = event.extended[EVENT_PROP_TYPE];
  const type = typeId ? getAppointmentType(typeId) : undefined;
  if (!type) {
    throw new BadRequestError(
      "This appointment can't be changed online. Please contact us.",
    );
  }
  return type;
}

function locationFromEvent(event: CalendarEventDetails): AppointmentLocation {
  const location = event.extended[EVENT_PROP_LOCATION];
  return location && isAppointmentLocation(location) ? location : "in-person";
}

/** Map a live calendar event to the manage DTO. */
function toDetails(
  event: CalendarEventDetails,
  staff: string,
  type: AppointmentTypeDef,
  location: AppointmentLocation,
): AppointmentManageDetails {
  const cancelled = event.status === "cancelled";
  const inFuture = event.start.getTime() > Date.now();
  return {
    status: cancelled ? "cancelled" : "confirmed",
    confirmationCode: event.extended[EVENT_PROP_CONFIRMATION] ?? "",
    typeId: type.id,
    typeName: type.name,
    staff,
    location,
    locationLabel: LOCATION_LABELS[location],
    start: event.start,
    end: event.end,
    timezone: appointmentTimezone(),
    ...(event.meetingUrl ? { meetingUrl: event.meetingUrl } : {}),
    canModify: !cancelled && inFuture,
  };
}

/** Email/notification details reconstructed from the event (phone/notes aren't
 * stored on the event, so they're omitted — the change/cancel mails don't need
 * them). */
function emailDetails(
  event: CalendarEventDetails,
  details: AppointmentManageDetails,
  timeZone: string,
  manageUrl?: string,
): AppointmentEmailDetails {
  return {
    customerName: event.extended[EVENT_PROP_NAME] || "there",
    email: event.extended[EVENT_PROP_EMAIL] ?? "",
    typeName: details.typeName,
    staff: details.staff,
    locationLabel: details.locationLabel,
    when: formatInZone(details.start, timeZone),
    confirmationCode: details.confirmationCode,
    ...(details.meetingUrl ? { meetingUrl: details.meetingUrl } : {}),
    ...(manageUrl ? { manageUrl } : {}),
  };
}

/** Load a booked appointment for the manage page (by its signed token). */
export async function getAppointmentForManage(
  token: string,
): Promise<AppointmentManageDetails> {
  const handle = resolveToken(token);
  const event = await getCalendarEvent(handle.staff, handle.eventId);
  if (!event) {
    throw new NotFoundError(
      "We couldn't find that appointment. It may have already been cancelled.",
    );
  }
  const type = typeFromEvent(event);
  const location = locationFromEvent(event);
  return toDetails(event, handle.staff, type, location);
}

/**
 * Move a booked appointment to a new start time. Re-checks the slot is still open
 * for the same staff/type/location, patches the calendar event, and emails a
 * confirmation. (Because the current booking counts as busy, a new time that
 * overlaps the existing one isn't offered — the customer picks a clearly
 * different slot, which is the intended flow.)
 */
export async function rescheduleAppointment(
  token: string,
  newStart: Date,
): Promise<AppointmentManageDetails> {
  const handle = resolveToken(token);
  if (Number.isNaN(newStart.getTime())) {
    throw new BadRequestError("That appointment time isn't valid.");
  }

  const event = await getCalendarEvent(handle.staff, handle.eventId);
  if (!event) {
    throw new NotFoundError(
      "We couldn't find that appointment. It may have already been cancelled.",
    );
  }
  if (event.status === "cancelled") {
    throw new ConflictError("This appointment has already been cancelled.");
  }
  if (event.start.getTime() <= Date.now()) {
    throw new ConflictError(
      "This appointment can no longer be changed online. Please contact us.",
    );
  }

  const type = typeFromEvent(event);
  const location = locationFromEvent(event);
  const timeZone = appointmentTimezone();
  const now = new Date();
  const dateStr = dateInZone(newStart, timeZone);

  const rangeStart = zonedWallClockToInstant(dateStr, 0, timeZone);
  const rangeEnd = zonedWallClockToInstant(
    addCalendarDays(dateStr, 1),
    0,
    timeZone,
  );

  const { weeklyHours, timeOff } = await getScheduleConfig();
  const bookings = await listBusyInRange(rangeStart, rangeEnd, [handle.staff]);

  const slots = computeSlots({
    type,
    location,
    staffFilter: handle.staff,
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

  const match = slots.find(
    (slot) => slot.start.getTime() === newStart.getTime(),
  );
  if (!match) {
    throw new BadRequestError(
      "That time is no longer available. Please choose another.",
    );
  }

  await updateCalendarEvent(handle.staff, handle.eventId, {
    start: match.start,
    end: match.end,
    timeZone,
  });

  // Re-read so the DTO/email reflect the new time (and any refreshed Meet link).
  const updated = (await getCalendarEvent(handle.staff, handle.eventId)) ?? {
    ...event,
    start: match.start,
    end: match.end,
  };
  const details = toDetails(updated, handle.staff, type, location);

  const from = fromAddress("appointments");
  const manageUrl = buildManageUrl(handle.email, handle.eventId, handle.staff);
  const mail = emailDetails(updated, details, timeZone, manageUrl);
  await sendEmailBestEffort({ ...appointmentRescheduledEmail(mail), from });
  const inbox = atelierInbox("appointments");
  if (inbox) {
    await sendEmailBestEffort({
      ...appointmentChangeNotificationEmail(mail, inbox, "rescheduled"),
      from,
    });
  }

  return details;
}

/**
 * Cancel a booked appointment: delete the calendar event (freeing the slot and
 * notifying the customer) and email a confirmation. Idempotent — cancelling an
 * appointment that's already gone/cancelled still succeeds, without re-emailing.
 */
export async function cancelAppointment(token: string): Promise<void> {
  const handle = resolveToken(token);
  const event = await getCalendarEvent(handle.staff, handle.eventId);

  // Already gone or cancelled → nothing to do (and no details to email from).
  if (!event || event.status === "cancelled") return;

  const type = typeFromEvent(event);
  const location = locationFromEvent(event);
  const timeZone = appointmentTimezone();
  const details = toDetails(event, handle.staff, type, location);

  await cancelCalendarEvent(handle.staff, handle.eventId);

  const from = fromAddress("appointments");
  const mail = emailDetails(event, details, timeZone);
  await sendEmailBestEffort({ ...appointmentCancelledEmail(mail), from });
  const inbox = atelierInbox("appointments");
  if (inbox) {
    await sendEmailBestEffort({
      ...appointmentChangeNotificationEmail(mail, inbox, "cancelled"),
      from,
    });
  }
}
