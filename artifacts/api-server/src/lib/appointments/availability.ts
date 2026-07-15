// Pure slot computation — the heart of real-time booking, with no I/O so it can
// be exhaustively unit-tested. It subtracts already-booked appointments (and
// staff time-off) from each staff member's weekly working grid to produce the
// open start times for a given type + location over a date window.
//
// The same function powers both the availability endpoint (a multi-day window)
// and the final booking re-check (a single day), so a slot can never be offered
// by one path and rejected by the other.

import type { AppointmentLocation, AppointmentTypeDef } from "./catalog.js";
import {
  addCalendarDays,
  weekdayName,
  zonedWallClockToInstant,
} from "./time.js";

/** One recurring weekly working block for a staff member, in local wall-clock. */
export interface WeeklyHours {
  staff: string;
  /** Long weekday name, e.g. "Monday". */
  weekday: string;
  startMinutes: number;
  endMinutes: number;
  locations: AppointmentLocation[];
}

/** A staff member's day(s) off, as an inclusive local date range. */
export interface TimeOff {
  staff: string;
  /** `YYYY-MM-DD`. */
  startDate: string;
  /** `YYYY-MM-DD`, inclusive; equals startDate for a single day. */
  endDate: string;
}

/** An existing booking, as a UTC instant range, that blocks overlapping slots. */
export interface Booking {
  staff: string;
  start: Date;
  end: Date;
}

/** An open slot offered to the customer, assigned to a concrete staff member. */
export interface Slot {
  start: Date;
  end: Date;
  staff: string;
}

export interface ComputeSlotsArgs {
  type: AppointmentTypeDef;
  location: AppointmentLocation;
  /** A specific staff member, or undefined for "no preference". */
  staffFilter?: string;
  /** First local day of the window, `YYYY-MM-DD`. */
  fromDate: string;
  /** Number of days in the window. */
  days: number;
  now: Date;
  timeZone: string;
  minLeadMinutes: number;
  slotStepMinutes: number;
  weeklyHours: WeeklyHours[];
  timeOff: TimeOff[];
  bookings: Booking[];
}

function isDayOff(staff: string, dateStr: string, timeOff: TimeOff[]): boolean {
  // YYYY-MM-DD compares correctly as strings.
  return timeOff.some(
    (off) =>
      off.staff === staff && dateStr >= off.startDate && dateStr <= off.endDate,
  );
}

function overlapsBooking(
  staff: string,
  start: Date,
  end: Date,
  bookings: Booking[],
): boolean {
  const startMs = start.getTime();
  const endMs = end.getTime();
  return bookings.some(
    (booking) =>
      booking.staff === staff &&
      booking.start.getTime() < endMs &&
      startMs < booking.end.getTime(),
  );
}

/**
 * Compute the open slots for a type + location over the window. For "no
 * preference" (no `staffFilter`), slots at the same start time are collapsed to
 * one, assigned to the first eligible staff member in the type's staff order, so
 * the customer sees distinct times and the booking still names a concrete
 * person. Returns slots sorted ascending by start.
 */
export function computeSlots(args: ComputeSlotsArgs): Slot[] {
  const {
    type,
    location,
    staffFilter,
    fromDate,
    days,
    now,
    timeZone,
    minLeadMinutes,
    slotStepMinutes,
    weeklyHours,
    timeOff,
    bookings,
  } = args;

  const eligibleStaff = type.staff.filter(
    (staff) => !staffFilter || staff === staffFilter,
  );
  if (eligibleStaff.length === 0) return [];

  const earliestMs = now.getTime() + minLeadMinutes * 60_000;
  const duration = type.durationMinutes;

  // Keyed by start-instant ms so "no preference" collapses duplicates; staff is
  // decided by the type's staff order (eligibleStaff iterated in that order).
  const byStart = new Map<number, Slot>();

  for (const staff of eligibleStaff) {
    for (let offset = 0; offset < days; offset++) {
      const dateStr = addCalendarDays(fromDate, offset);
      if (isDayOff(staff, dateStr, timeOff)) continue;

      const weekday = weekdayName(dateStr);
      const blocks = weeklyHours.filter(
        (block) =>
          block.staff === staff &&
          block.weekday === weekday &&
          block.locations.includes(location),
      );

      for (const block of blocks) {
        for (
          let startMin = block.startMinutes;
          startMin + duration <= block.endMinutes;
          startMin += slotStepMinutes
        ) {
          const start = zonedWallClockToInstant(dateStr, startMin, timeZone);
          if (start.getTime() < earliestMs) continue;
          const end = new Date(start.getTime() + duration * 60_000);
          if (overlapsBooking(staff, start, end, bookings)) continue;

          const key = start.getTime();
          if (!byStart.has(key)) {
            byStart.set(key, { start, end, staff });
          }
        }
      }
    }
  }

  return [...byStart.values()].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
}
