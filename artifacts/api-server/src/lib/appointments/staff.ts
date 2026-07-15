// Staff working-hours + calendar config, read from the `APPOINTMENT_STAFF`
// environment variable at call time (not module load), like `settings.ts`.
//
// This is the *positive* availability grid — "when is each person open for
// bookings" — that Google Calendar free/busy can't provide (free/busy only
// tells us when someone is *busy*). It's a set-once config the atelier edits in
// the Vercel dashboard; day-to-day blocking (a day off, a personal appointment)
// happens on the actual Google Calendar and is subtracted as busy time.
//
// Shape (JSON):
//   [
//     { "name": "Alexandra", "email": "alexandra@atelier.com",
//       "hours": [ { "days": ["Mon","Tue"], "start": "10:00", "end": "17:00",
//                    "locations": ["in-person","virtual"] } ] }
//   ]
// `name` must match the catalog STAFF names; `email` is the Workspace calendar
// we read free/busy from and write the booking to.

import { z } from "zod";
import type { AppointmentLocation } from "./catalog.js";
import type { WeeklyHours } from "./availability.js";
import { parseTimeToMinutes } from "./time.js";

const WEEKDAY_BY_ABBREVIATION: Record<string, string> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};
const FULL_WEEKDAYS = new Set(Object.values(WEEKDAY_BY_ABBREVIATION));

const hoursBlockSchema = z.object({
  days: z.array(z.string()).min(1),
  start: z.string(),
  end: z.string(),
  locations: z.array(z.enum(["in-person", "virtual"])).min(1),
});

const staffSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  hours: z.array(hoursBlockSchema),
});

const staffConfigSchema = z.array(staffSchema);
type StaffConfig = z.infer<typeof staffConfigSchema>;

/** Map "Mon"/"monday"/"Monday" → canonical long weekday name, or null. */
function normalizeWeekday(value: string): string | null {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (WEEKDAY_BY_ABBREVIATION[lower.slice(0, 3)]) {
    // Accept both "Mon" and "Monday" (both start with the 3-letter key).
    const full = WEEKDAY_BY_ABBREVIATION[lower.slice(0, 3)];
    if (
      lower === full.toLowerCase() ||
      lower === full.slice(0, 3).toLowerCase()
    ) {
      return full;
    }
  }
  const capitalized =
    trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  return FULL_WEEKDAYS.has(capitalized) ? capitalized : null;
}

function loadStaffConfig(): StaffConfig {
  const raw = process.env.APPOINTMENT_STAFF;
  if (!raw) {
    throw new Error("APPOINTMENT_STAFF environment variable is not set");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("APPOINTMENT_STAFF is not valid JSON");
  }
  const result = staffConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`APPOINTMENT_STAFF is invalid: ${result.error.message}`);
  }
  return result.data;
}

/** Each configured staff member's booking calendar (Workspace email). */
export function staffCalendars(): Array<{ name: string; email: string }> {
  return loadStaffConfig().map((staff) => ({
    name: staff.name,
    email: staff.email,
  }));
}

/** The calendar email for a staff member, or undefined if not configured. */
export function calendarEmailFor(staffName: string): string | undefined {
  return loadStaffConfig().find((staff) => staff.name === staffName)?.email;
}

/**
 * Expand the config into the flat `WeeklyHours[]` grid `computeSlots` consumes —
 * one entry per (staff, weekday, block). Malformed blocks (bad time, unknown
 * weekday, inverted range) are skipped rather than failing the whole request.
 */
export function weeklyHoursFromConfig(): WeeklyHours[] {
  const hours: WeeklyHours[] = [];
  for (const staff of loadStaffConfig()) {
    for (const block of staff.hours) {
      const startMinutes = parseTimeToMinutes(block.start);
      const endMinutes = parseTimeToMinutes(block.end);
      if (
        startMinutes === null ||
        endMinutes === null ||
        endMinutes <= startMinutes
      ) {
        continue;
      }
      for (const day of block.days) {
        const weekday = normalizeWeekday(day);
        if (!weekday) continue;
        hours.push({
          staff: staff.name,
          weekday,
          startMinutes,
          endMinutes,
          locations: block.locations as AppointmentLocation[],
        });
      }
    }
  }
  return hours;
}
