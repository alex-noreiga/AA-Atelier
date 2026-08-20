// The studio's standing working hours, assembled for the slot calculator.
//
// This is the seam everything scheduling-related reads the schedule through:
// the repository owns the fetch + its short-TTL cache, `buildSchedule` owns the
// pure mapping, and this module is the one place that puts the two together.
// Keeping it here rather than in `lib/google/` is what lets the Calendar adapter
// ask "when does this person work, and which calendar is theirs?" without
// knowing where the answer is stored — it has been a Google Sheet, then a Notion
// database, and is now a Postgres table, and neither `calendar.repository.ts`
// nor the appointment services had to change for any of it.

import { listStaffAvailability } from "../db/staff-availability.repository.js";
import { buildSchedule, type ParsedSchedule } from "./staff.js";

/** The weekly-hours grid + the staff→calendar-email map. */
export async function getStaffSchedule(): Promise<ParsedSchedule> {
  return buildSchedule(await listStaffAvailability());
}

/** The booking calendar for a staff member, or undefined if they have no hours. */
export async function calendarEmailFor(
  staffName: string,
): Promise<string | undefined> {
  return (await getStaffSchedule()).calendars.get(staffName);
}
