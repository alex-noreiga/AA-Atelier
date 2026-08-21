// Day-before appointment reminders, independent of HTTP.
//
// A booking exists only as an event on a staff member's Google Calendar — there
// is no appointments database — so this is a SWEEP over a time window rather than
// a per-booking timer: read every appointment starting between now and the end of
// the local day `reminderLeadDays()` ahead, and remind whoever hasn't been
// reminded about that exact start time yet.
//
// Google does send its own calendar notifications, and this is deliberately not
// that. Those go to whoever accepted the invite, in whatever form their calendar
// is configured for, and carry none of what the atelier wants in front of the
// customer the night before: the reschedule link that frees the slot instead of
// producing a no-show, the Meet link for a virtual fitting, the confirmation code.
//
// Three rules carry the design:
//
//  1. **The event is both the record and the marker.** What went out is written
//     back onto the event (`aptRemindedEmail` = the start instant reminded about),
//     so the feature needs no table, no Notion property, and nothing to configure.
//     A reschedule moves `start`, the marker stops matching, and the customer is
//     reminded about the new time — the correct behaviour falls out of the shape
//     rather than needing a rule of its own.
//  2. **Send, then mark.** If marking fails the customer may be reminded twice
//     (bounded: once per nightly run inside the lead window, so once in practice
//     at the default lead of 1 day). That is the right way round to fail here —
//     the whole card exists because a missed reminder costs studio time, while a
//     duplicate costs nothing but a second read. The restock sweep claims BEFORE
//     it sends for the opposite reason: its window never closes, so a lost marker
//     there means emailing the same person every night forever.
//  3. **Quiet when there is nothing to do, and quiet when unconfigured.** This
//     runs unattended every night. An install without Google (or without the
//     Postgres the working hours live in) reports "skipped" rather than throwing
//     a configuration error into the cron's alert mail nightly.
//
// The mail is best-effort like every other customer email, from the appointments
// sender. There is deliberately no atelier notification: the studio's own
// calendar is already the day sheet.
//
// SMS (the roadmap's own card) drops in beside the email send below: the number
// is already stamped on the event (`aptPhone`), the marker is already per-channel
// (`aptRemindedSms`), and the content this composes is transport-agnostic. What
// it still needs is a vendor and an opt-in — see `.agents/memory/appointment-reminders.md`.

import {
  listAppointmentsInRange,
  markAppointmentReminded,
  EVENT_PROP_EMAIL,
  EVENT_PROP_NAME,
  type StaffCalendarEvent,
} from "../lib/google/calendar.repository.js";
import { googleCalendarConfigured } from "../lib/google/client.js";
import { postgresConfigured } from "../lib/db/client.js";
import {
  reminderDue,
  reminderMarkerKey,
  reminderMarkerValue,
  reminderWindow,
  whenPhrase,
} from "../lib/appointments/reminders.js";
import {
  appointmentTimezone,
  reminderLeadDays,
} from "../lib/appointments/settings.js";
import {
  eventToDetailsOrNull,
  type AppointmentManageDetails,
} from "../lib/appointments/event-details.js";
import { formatInZone } from "../lib/appointments/time.js";
import { buildManageUrl } from "./appointment-manage.service.js";
import { appointmentReminderEmail } from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress } from "../lib/resend/config.js";
import { logger } from "../lib/logger.js";

/** The outcome of one sweep, for the caller's response. */
export interface AppointmentReminderResult {
  status: "sent" | "skipped" | "unconfigured";
  /** Reminder emails sent this run. */
  sent: number;
  /** Bookings in the window whose customer had already been reminded. */
  alreadyReminded: number;
  /** Bookings in the window this couldn't remind about — cancelled, or missing
   * the metadata a reminder is built from (a legacy event, or one the atelier
   * created by hand on the calendar). */
  skipped: number;
  /** Why nothing was sent. */
  reason?: string;
}

function empty(
  status: AppointmentReminderResult["status"],
  extra: Partial<AppointmentReminderResult> = {},
): AppointmentReminderResult {
  return { status, sent: 0, alreadyReminded: 0, skipped: 0, ...extra };
}

/** Send one booking's reminder. Best-effort mail, then the marker; a marker
 * failure is logged rather than thrown, so one event can't strand the rest of
 * the night's reminders (see rule 2 in the header). */
async function remind(
  entry: StaffCalendarEvent,
  details: AppointmentManageDetails,
  now: Date,
  timeZone: string,
): Promise<void> {
  const { staff, event } = entry;
  const email = event.extended[EVENT_PROP_EMAIL] ?? "";
  const manageUrl = buildManageUrl(email, event.id, staff);

  await sendEmailBestEffort({
    ...appointmentReminderEmail({
      customerName: event.extended[EVENT_PROP_NAME] || "there",
      email,
      typeName: details.typeName,
      staff: details.staff,
      locationLabel: details.locationLabel,
      when: formatInZone(details.start, timeZone),
      whenPhrase: whenPhrase(details.start, now, timeZone),
      confirmationCode: details.confirmationCode,
      ...(details.meetingUrl ? { meetingUrl: details.meetingUrl } : {}),
      ...(manageUrl ? { manageUrl } : {}),
    }),
    from: fromAddress("appointments"),
  });

  try {
    await markAppointmentReminded(staff, event.id, event.extended, {
      key: reminderMarkerKey("email"),
      value: reminderMarkerValue(event.start),
    });
  } catch (err) {
    logger.warn(
      { err, eventId: event.id, staff },
      "Sent an appointment reminder but couldn't mark the event; it may be sent again",
    );
  }
}

/**
 * Remind every customer with an appointment coming up inside the reminder window
 * who hasn't already been reminded about that booking at that time.
 *
 * Only the calendar read throws (the caller alerts and retries next run); the
 * emails and markers never do, so one unreadable event can't strand the queue.
 */
export async function notifyUpcomingAppointments(
  now: Date = new Date(),
): Promise<AppointmentReminderResult> {
  // Both are hard requirements rather than degrade-safe: without Google there
  // are no bookings to read, and without Postgres there are no working hours,
  // hence no staff calendars to read them from. Say so quietly — this runs
  // nightly, and an install that never configured appointments hasn't a fault
  // to report.
  if (!googleCalendarConfigured() || !postgresConfigured()) {
    logger.warn(
      "Appointment reminders skipped: appointment scheduling isn't configured (needs GOOGLE_SERVICE_ACCOUNT_KEY and POSTGRES_URL).",
    );
    return empty("unconfigured", {
      reason:
        "Appointment scheduling isn't configured, so there are no bookings to remind about.",
    });
  }

  const timeZone = appointmentTimezone();
  const { from, to } = reminderWindow(now, timeZone, reminderLeadDays());
  const upcoming = await listAppointmentsInRange(from, to);

  let sent = 0;
  let alreadyReminded = 0;
  let skipped = 0;

  for (const entry of upcoming) {
    const { event } = entry;
    // A cancelled event is still returned by the list; nobody is coming to it.
    if (event.status === "cancelled") {
      skipped += 1;
      continue;
    }
    if (!reminderDue(event.extended, event.start, "email")) {
      alreadyReminded += 1;
      continue;
    }
    // No recognizable type (a hand-made calendar entry) or nobody to write to.
    const details = eventToDetailsOrNull(event, entry.staff);
    if (!details || !event.extended[EVENT_PROP_EMAIL]) {
      skipped += 1;
      continue;
    }

    try {
      await remind(entry, details, now, timeZone);
      sent += 1;
    } catch (err) {
      logger.warn(
        { err, eventId: event.id },
        "Couldn't send an appointment reminder; will retry on the next run",
      );
      skipped += 1;
    }
  }

  if (sent === 0) {
    return {
      ...empty("skipped"),
      alreadyReminded,
      skipped,
      reason:
        alreadyReminded > 0
          ? "everyone with an appointment coming up has already been reminded"
          : "there are no appointments coming up in the reminder window",
    };
  }

  logger.info(
    { sent, alreadyReminded, skipped },
    "Sent day-before appointment reminders",
  );
  return { status: "sent", sent, alreadyReminded, skipped };
}
