// The day-before appointment reminder's business rules, kept pure so the window
// math, the "have we already told them?" test, and the wording of *when* can be
// tested without Google, Resend, or a clock. The sweep that uses them is
// `services/appointment-reminder.service.ts`.
//
// Two decisions carry this file:
//
//  1. **The window is a calendar day, not a duration.** "The day before" is a
//     date the customer would recognize, not "24 hours out": the nightly run
//     fires in the small hours, so an appointment at 9am tomorrow is ~30 hours
//     away when the sweep sees it and a 24-hour cutoff would silently skip it.
//     So the window runs from `now` to the END of the local day `leadDays` ahead
//     — which also catches anything still to come *today*, so a missed nightly
//     run degrades to a late reminder instead of none.
//
//  2. **The marker is the start time we reminded about, not a flag.** A customer
//     who reschedules after being reminded must be reminded again about the new
//     time, and a boolean can't say that. Storing the instant makes the marker
//     self-healing: it stops matching the moment the booking moves. Each channel
//     keeps its own marker (`aptRemindedEmail`, `aptRemindedSms`) so adding a
//     second one starts with a clean history rather than inheriting the first's.

import {
  addCalendarDays,
  dateInZone,
  zonedWallClockToInstant,
} from "./time.js";

/** How a reminder can reach the customer. Only `email` is wired up today; `sms`
 * is named here (and given its own marker) because the marker is the part that
 * cannot be retro-fitted — see the header. */
export type ReminderChannel = "email" | "sms";

/** The private event properties each channel records its reminders in. They live
 * here rather than with the other `EVENT_PROP_*` names in the Calendar adapter
 * because they are this policy's vocabulary — the adapter only ever writes the
 * key it is handed, so it needs no opinion about them. */
const MARKER_KEYS: Record<ReminderChannel, string> = {
  email: "aptRemindedEmail",
  sms: "aptRemindedSms",
};

/** The event property one channel records its reminders in. */
export function reminderMarkerKey(channel: ReminderChannel): string {
  return MARKER_KEYS[channel];
}

/** What a channel writes once it has reminded about a booking: the start instant
 * it reminded about, so the marker stops matching if the booking is moved. */
export function reminderMarkerValue(start: Date): string {
  return start.toISOString();
}

/**
 * The span of appointments a run should consider: from `now` (never earlier —
 * an appointment that has begun needs no reminder) to the last instant of the
 * local day `leadDays` ahead. With the default lead of 1 that is "everything
 * still to come today, plus all of tomorrow".
 */
export function reminderWindow(
  now: Date,
  timeZone: string,
  leadDays: number,
): { from: Date; to: Date } {
  const lastDay = addCalendarDays(dateInZone(now, timeZone), leadDays);
  // Midnight at the start of the day after the last one, i.e. an exclusive end.
  const to = zonedWallClockToInstant(addCalendarDays(lastDay, 1), 0, timeZone);
  return { from: now, to };
}

/** Whether this channel still owes a reminder for a booking at `start`, given the
 * event's private properties. False once the marker matches this exact start. */
export function reminderDue(
  extended: Record<string, string>,
  start: Date,
  channel: ReminderChannel,
): boolean {
  return extended[reminderMarkerKey(channel)] !== reminderMarkerValue(start);
}

/** "today" / "tomorrow" / "on Monday, August 25" — how the reminder refers to
 * when the appointment is, read in the atelier's timezone. Anything further out
 * than tomorrow is named rather than counted, because "in 3 days" is a small sum
 * for the reader to do and a date is not. */
export function whenPhrase(start: Date, now: Date, timeZone: string): string {
  const today = dateInZone(now, timeZone);
  const day = dateInZone(start, timeZone);
  if (day === today) return "today";
  if (day === addCalendarDays(today, 1)) return "tomorrow";
  return `on ${new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(start)}`;
}
