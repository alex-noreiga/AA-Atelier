// Pure parser for the staff working-hours schedule. The rows come from the
// Google Sheet the atelier edits (see `lib/google/sheets.repository.ts`); this
// module turns them into the *positive* availability grid `computeSlots` needs
// plus a staff→calendar-email map. No I/O and no env reads, so it's fully
// unit-testable — the sheet fetch/cache lives in the repository.
//
// A row is a flat record of strings (one spreadsheet row): staff, email, day,
// start, end, locations. `day` may be a single day, a comma list ("Mon,Wed"),
// or a hyphen range ("Mon-Fri"); "Mon" and "Monday" are both accepted.
// Malformed rows are skipped rather than failing the whole request.

import type { AppointmentLocation } from "./catalog.js";
import type { WeeklyHours } from "./availability.js";
import { parseTimeToMinutes } from "./time.js";

/** One raw spreadsheet row (already split into columns, still strings). */
export interface ScheduleRow {
  staff: string;
  email: string;
  day: string;
  start: string;
  end: string;
  locations: string;
}

export interface ParsedSchedule {
  weeklyHours: WeeklyHours[];
  /** staff name → booking calendar email. */
  calendars: Map<string, string>;
}

// Monday-first order so a range like "Mon-Fri" expands in the natural direction.
const WEEKDAY_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
const WEEKDAY_INDEX = new Map<string, number>(
  WEEKDAY_ORDER.map((name, i) => [name, i]),
);

/** Map "Mon" / "monday" / "Monday" → canonical long weekday name, or null. */
function normalizeWeekday(value: string): string | null {
  const key = value.trim().slice(0, 3).toLowerCase();
  const match = WEEKDAY_ORDER.find(
    (name) => name.slice(0, 3).toLowerCase() === key,
  );
  return match ?? null;
}

/** Expand a day cell ("Mon", "Mon,Wed", "Mon-Fri") into long weekday names. */
function expandDays(cell: string): string[] {
  const out: string[] = [];
  for (const token of cell.split(",")) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const range = trimmed.split("-");
    if (range.length === 2) {
      const from = normalizeWeekday(range[0]);
      const to = normalizeWeekday(range[1]);
      if (!from || !to) continue;
      // Walk forward (wrapping) from `from` to `to` inclusive.
      const start = WEEKDAY_INDEX.get(from)!;
      const end = WEEKDAY_INDEX.get(to)!;
      const span = (end - start + 7) % 7;
      for (let i = 0; i <= span; i++) {
        out.push(WEEKDAY_ORDER[(start + i) % 7]);
      }
    } else {
      const day = normalizeWeekday(trimmed);
      if (day) out.push(day);
    }
  }
  // De-dupe while preserving order.
  return [...new Set(out)];
}

/** Parse a locations cell ("in-person, virtual" / "In person") → ids. */
function parseLocations(cell: string): AppointmentLocation[] {
  const seen = new Set<AppointmentLocation>();
  for (const token of cell.split(",")) {
    const normalized = token.trim().toLowerCase().replace(/\s+/g, "-");
    if (normalized === "in-person") seen.add("in-person");
    else if (normalized === "virtual") seen.add("virtual");
  }
  return [...seen];
}

/**
 * Turn schedule rows into the weekly-hours grid + the staff→email map. Each row
 * expands into one `WeeklyHours` per weekday. Rows missing a staff/day/valid
 * time/location are skipped; the first email seen for a staff name wins.
 */
export function parseScheduleRows(rows: ScheduleRow[]): ParsedSchedule {
  const weeklyHours: WeeklyHours[] = [];
  const calendars = new Map<string, string>();

  for (const row of rows) {
    const staff = row.staff.trim();
    if (!staff) continue;

    const email = row.email.trim();
    if (email && !calendars.has(staff)) {
      calendars.set(staff, email);
    }

    const startMinutes = parseTimeToMinutes(row.start);
    const endMinutes = parseTimeToMinutes(row.end);
    if (
      startMinutes === null ||
      endMinutes === null ||
      endMinutes <= startMinutes
    ) {
      continue;
    }

    const locations = parseLocations(row.locations);
    if (locations.length === 0) continue;

    for (const weekday of expandDays(row.day)) {
      weeklyHours.push({ staff, weekday, startMinutes, endMinutes, locations });
    }
  }

  return { weeklyHours, calendars };
}
