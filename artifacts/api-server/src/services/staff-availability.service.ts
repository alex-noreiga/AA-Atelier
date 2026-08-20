// The studio dashboard's working-hours editor, HTTP-agnostic.
//
// This is the whole point of moving the schedule off a spreadsheet: a sheet
// accepts anything typed into a cell, and a row the parser can't make sense of
// simply doesn't produce bookable hours — silently, with nothing to tell the
// atelier why a day stopped being offered. Here every entry is checked before it
// is stored, and a rejection says what is wrong.
//
// Four rules, all of them things a spreadsheet couldn't enforce:
//
//  1. **The staff name must be one the studio books.** The appointment catalog
//     decides who offers what (`lib/appointments/catalog.ts`); hours saved
//     against a name outside it would never appear in a slot, because no type
//     routes to that person. So the editor is given the catalog's list and the
//     server checks against the same source.
//  2. **The times must make a real range.** `end` after `start`, both `HH:MM`
//     (the shape is the contract's; the ordering is checked here, since a flat
//     schema can't express a cross-field rule).
//  3. **At least one weekday and one location**, again enforced by the contract
//     but re-checked here after normalization — "Mon" and "Monday" are the same
//     day, and de-duping happens before the row is written.
//  4. **Everything is stored canonically.** Weekday names in week order,
//     locations as the ids the slot calculator uses, so a row written here reads
//     the same as every other one no matter how it was typed.

import {
  listStaffAvailability,
  createStaffAvailability,
  updateStaffAvailability,
  archiveStaffAvailability,
} from "../lib/notion/staff-availability.repository.js";
import {
  normalizeWeekday,
  normalizeLocation,
  WEEKDAY_ORDER,
  type ScheduleEntry,
} from "../lib/appointments/staff.js";
import {
  APPOINTMENT_TYPES,
  LOCATION_LABELS,
  type AppointmentLocation,
} from "../lib/appointments/catalog.js";
import { parseTimeToMinutes } from "../lib/appointments/time.js";
import { normalizeEmail } from "../lib/email.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";

/** One entry as the dashboard sees it. Mirrors the contract's
 * `StaffAvailabilityEntry`. */
export interface StaffAvailabilityView {
  id: string;
  staff: string;
  calendarEmail: string;
  weekdays: string[];
  start: string;
  end: string;
  locations: AppointmentLocation[];
}

/** What the editor submits, on create and update alike. */
export interface StaffAvailabilityInput {
  staff: string;
  calendarEmail: string;
  weekdays: string[];
  start: string;
  end: string;
  locations: string[];
}

/**
 * Every staff member the studio books, in catalog order. Derived from the
 * appointment types rather than listed again, so retiring a type that was one
 * person's only offering takes them out of the editor too.
 */
export function bookableStaff(): string[] {
  const names: string[] = [];
  for (const type of APPOINTMENT_TYPES) {
    for (const name of type.staff) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/** Canonicalize + validate one submitted entry, or throw a 400 saying why. */
function toScheduleEntry(input: StaffAvailabilityInput): ScheduleEntry {
  const staff = input.staff.trim();
  if (!bookableStaff().includes(staff)) {
    throw new BadRequestError(
      `"${staff}" isn't someone the studio books appointments with. Choose ${bookableStaff().join(" or ")}.`,
    );
  }

  const email = normalizeEmail(input.calendarEmail);
  if (!email) {
    throw new BadRequestError("A calendar email is required.");
  }

  const days = new Set<string>();
  for (const raw of input.weekdays) {
    const day = normalizeWeekday(raw);
    if (!day) throw new BadRequestError(`"${raw}" isn't a day of the week.`);
    days.add(day);
  }
  const weekdays = WEEKDAY_ORDER.filter((day) => days.has(day));
  if (weekdays.length === 0) {
    throw new BadRequestError("Choose at least one day of the week.");
  }

  const startMinutes = parseTimeToMinutes(input.start);
  const endMinutes = parseTimeToMinutes(input.end);
  if (startMinutes === null || endMinutes === null) {
    throw new BadRequestError("Start and end must be times like 10:00.");
  }
  if (endMinutes <= startMinutes) {
    throw new BadRequestError("The end time must be after the start time.");
  }

  const locations: AppointmentLocation[] = [];
  for (const raw of input.locations) {
    const location = normalizeLocation(raw);
    if (!location) {
      throw new BadRequestError(`"${raw}" isn't a location we book.`);
    }
    if (!locations.includes(location)) locations.push(location);
  }
  if (locations.length === 0) {
    throw new BadRequestError("Choose at least one location.");
  }

  return {
    staff,
    email,
    weekdays: [...weekdays],
    start: input.start.trim(),
    end: input.end.trim(),
    // Stored as the atelier's own labels ("In person"), read back as ids — the
    // row stays legible in Notion without the slot calculator caring.
    locations: locations.map((id) => LOCATION_LABELS[id]),
  };
}

/** Map a stored entry to the view, dropping anything unrecognizable — a
 * hand-edited row shows what it will actually do, not what it says. */
function toView(record: { id: string } & ScheduleEntry): StaffAvailabilityView {
  const days = new Set<string>();
  for (const raw of record.weekdays) {
    const day = normalizeWeekday(raw);
    if (day) days.add(day);
  }
  const locations: AppointmentLocation[] = [];
  for (const raw of record.locations) {
    const location = normalizeLocation(raw);
    if (location && !locations.includes(location)) locations.push(location);
  }
  return {
    id: record.id,
    staff: record.staff,
    calendarEmail: record.email,
    weekdays: WEEKDAY_ORDER.filter((day) => days.has(day)),
    start: record.start,
    end: record.end,
    locations,
  };
}

/** The whole schedule, plus the staff it may be assigned to. */
export async function getStaffAvailability(): Promise<{
  entries: StaffAvailabilityView[];
  staff: string[];
}> {
  const records = await listStaffAvailability();
  return { entries: records.map(toView), staff: bookableStaff() };
}

export async function addStaffAvailability(
  input: StaffAvailabilityInput,
): Promise<StaffAvailabilityView> {
  return toView(await createStaffAvailability(toScheduleEntry(input)));
}

export async function editStaffAvailability(
  entryId: string,
  input: StaffAvailabilityInput,
): Promise<StaffAvailabilityView> {
  const updated = await updateStaffAvailability(
    entryId,
    toScheduleEntry(input),
  );
  if (!updated) {
    throw new NotFoundError("That block of hours no longer exists.");
  }
  return toView(updated);
}

export async function removeStaffAvailability(entryId: string): Promise<void> {
  const removed = await archiveStaffAvailability(entryId);
  if (!removed) {
    throw new NotFoundError("That block of hours no longer exists.");
  }
}
