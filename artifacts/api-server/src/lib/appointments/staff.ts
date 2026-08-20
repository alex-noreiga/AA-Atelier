// Pure mapper for the staff working-hours schedule. The entries come from the
// `staff_availability` table the atelier edits on the studio dashboard (see
// `lib/db/staff-availability.repository.ts`); this module turns them into the
// *positive* availability grid `computeSlots` needs plus a staff→calendar-email
// map. No I/O and no env reads, so it's fully unit-testable — the fetch/cache
// lives in the repository.
//
// The dashboard's editor validates before writing and the table's check
// constraints back it up, so the entries this sees are well-formed in practice.
// It stays tolerant anyway — it long predates that, and the tolerance costs
// nothing: "Mon" and "Monday" both read as Monday, "In person" as the
// `in-person` location, and an entry that can't be made sense of is skipped
// rather than failing the whole request, so one bad row can never take every
// staff member's hours down with it.

import type { AppointmentLocation } from "./catalog.js";
import type { WeeklyHours } from "./availability.js";
import { parseTimeToMinutes } from "./time.js";

/** One block of standing hours, as stored: strings straight off the row. */
export interface ScheduleEntry {
  staff: string;
  /** The staff member's booking calendar. */
  email: string;
  /** Weekday names this block repeats on ("Monday", or a tolerated "Mon"). */
  weekdays: string[];
  /** Local wall-clock `HH:MM`. */
  start: string;
  end: string;
  /** Location ids ("in-person" / "virtual"; a legacy "In person" is tolerated). */
  locations: string[];
}

export interface ParsedSchedule {
  weeklyHours: WeeklyHours[];
  /** staff name → booking calendar email. */
  calendars: Map<string, string>;
}

// Monday-first, the order the dashboard lists a week in.
export const WEEKDAY_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/** Map "Mon" / "monday" / "Monday" → canonical long weekday name, or null. */
export function normalizeWeekday(value: string): string | null {
  const key = value.trim().slice(0, 3).toLowerCase();
  const match = WEEKDAY_ORDER.find(
    (name) => name.slice(0, 3).toLowerCase() === key,
  );
  return match ?? null;
}

/** Map "In person" / "in-person" / "virtual" → a location id, or null. */
export function normalizeLocation(value: string): AppointmentLocation | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (normalized === "in-person") return "in-person";
  if (normalized === "virtual") return "virtual";
  return null;
}

/** The recognized weekdays of an entry, de-duped and in week order. */
function weekdaysOf(entry: ScheduleEntry): string[] {
  const seen = new Set<string>();
  for (const raw of entry.weekdays) {
    const day = normalizeWeekday(raw);
    if (day) seen.add(day);
  }
  return WEEKDAY_ORDER.filter((day) => seen.has(day));
}

/** The recognized locations of an entry, de-duped. */
function locationsOf(entry: ScheduleEntry): AppointmentLocation[] {
  const seen = new Set<AppointmentLocation>();
  for (const raw of entry.locations) {
    const location = normalizeLocation(raw);
    if (location) seen.add(location);
  }
  return [...seen];
}

/**
 * Turn schedule entries into the weekly-hours grid + the staff→email map. Each
 * entry expands into one `WeeklyHours` per weekday it covers. Entries missing a
 * staff name, a usable time range, or a recognizable location are skipped; the
 * first email seen for a staff name wins.
 */
export function buildSchedule(entries: ScheduleEntry[]): ParsedSchedule {
  const weeklyHours: WeeklyHours[] = [];
  const calendars = new Map<string, string>();

  for (const entry of entries) {
    const staff = entry.staff.trim();
    if (!staff) continue;

    const email = entry.email.trim();
    if (email && !calendars.has(staff)) {
      calendars.set(staff, email);
    }

    const startMinutes = parseTimeToMinutes(entry.start);
    const endMinutes = parseTimeToMinutes(entry.end);
    if (
      startMinutes === null ||
      endMinutes === null ||
      endMinutes <= startMinutes
    ) {
      continue;
    }

    const locations = locationsOf(entry);
    if (locations.length === 0) continue;

    for (const weekday of weekdaysOf(entry)) {
      weeklyHours.push({ staff, weekday, startMinutes, endMinutes, locations });
    }
  }

  return { weeklyHours, calendars };
}
