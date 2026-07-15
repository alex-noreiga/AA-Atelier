// Notion property-name constants + extraction helpers for the "Staff
// Availability" database. As with the orders/contact schemas, property *types*
// here must match the live Notion schema, not the name (see `.agents/memory/`).
// All property-name literals live here so a Notion rename is a one-line change.
//
// The database holds two kinds of row, separated by the "Kind" select:
//   - "Weekly hours": Staff, Day, Start time, End time, Locations
//   - "Time off":     Staff, Date (a single date or a range)
// Only rows with the "Active" checkbox ticked are read.

import type { AppointmentLocation } from "../appointments/catalog.js";
import { LOCATION_LABELS } from "../appointments/catalog.js";
import type { WeeklyHours, TimeOff } from "../appointments/availability.js";
import { parseTimeToMinutes } from "../appointments/time.js";

export const AVAIL_STAFF_PROPERTY = "Staff"; // select
export const AVAIL_KIND_PROPERTY = "Kind"; // select
export const AVAIL_DAY_PROPERTY = "Day"; // select (weekday long name)
export const AVAIL_START_PROPERTY = "Start time"; // rich_text "09:00"
export const AVAIL_END_PROPERTY = "End time"; // rich_text "17:00"
export const AVAIL_LOCATIONS_PROPERTY = "Locations"; // multi_select
export const AVAIL_ACTIVE_PROPERTY = "Active"; // checkbox
export const AVAIL_DATE_PROPERTY = "Date"; // date (single or range)

export const AVAIL_KIND_WEEKLY = "Weekly hours";
export const AVAIL_KIND_TIME_OFF = "Time off";

// Minimal shape of the Notion properties this reader touches. Kept loose (each
// property optional) because a row only fills the fields for its Kind.
interface NotionAvailabilityPage {
  properties: Record<
    string,
    {
      type?: string;
      select?: { name: string } | null;
      multi_select?: Array<{ name: string }>;
      rich_text?: Array<{ plain_text: string }>;
      checkbox?: boolean;
      date?: { start: string; end: string | null } | null;
    }
  >;
}

export interface NotionAvailabilityQueryResponse {
  results: NotionAvailabilityPage[];
  has_more: boolean;
  next_cursor: string | null;
}

function selectName(page: NotionAvailabilityPage, prop: string): string {
  return page.properties[prop]?.select?.name ?? "";
}

function richText(page: NotionAvailabilityPage, prop: string): string {
  return (
    page.properties[prop]?.rich_text?.map((t) => t.plain_text).join("") ?? ""
  );
}

/** Map a Notion location option name ("In person"/"Virtual"/"in-person") to an id. */
function parseLocation(name: string): AppointmentLocation | null {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, "-");
  if (normalized === "in-person") return "in-person";
  if (normalized === "virtual") return "virtual";
  return null;
}

/** All configured location ids for a weekly-hours row (deduped, valid only). */
function extractLocations(page: NotionAvailabilityPage): AppointmentLocation[] {
  const names = page.properties[AVAIL_LOCATIONS_PROPERTY]?.multi_select ?? [];
  const seen = new Set<AppointmentLocation>();
  for (const option of names) {
    const location = parseLocation(option.name);
    if (location) seen.add(location);
  }
  return [...seen];
}

export function extractIsActive(page: NotionAvailabilityPage): boolean {
  return page.properties[AVAIL_ACTIVE_PROPERTY]?.checkbox ?? false;
}

export function extractKind(page: NotionAvailabilityPage): string {
  return selectName(page, AVAIL_KIND_PROPERTY);
}

/** A weekly-hours row → domain `WeeklyHours`, or null if it's incomplete. */
export function extractWeeklyHours(
  page: NotionAvailabilityPage,
): WeeklyHours | null {
  const staff = selectName(page, AVAIL_STAFF_PROPERTY);
  const weekday = selectName(page, AVAIL_DAY_PROPERTY);
  const startMinutes = parseTimeToMinutes(richText(page, AVAIL_START_PROPERTY));
  const endMinutes = parseTimeToMinutes(richText(page, AVAIL_END_PROPERTY));
  const locations = extractLocations(page);

  if (
    !staff ||
    !weekday ||
    startMinutes === null ||
    endMinutes === null ||
    endMinutes <= startMinutes ||
    locations.length === 0
  ) {
    return null;
  }
  return { staff, weekday, startMinutes, endMinutes, locations };
}

/** A time-off row → domain `TimeOff`, or null if it has no staff/date. */
export function extractTimeOff(page: NotionAvailabilityPage): TimeOff | null {
  const staff = selectName(page, AVAIL_STAFF_PROPERTY);
  const date = page.properties[AVAIL_DATE_PROPERTY]?.date;
  if (!staff || !date?.start) return null;
  // Notion dates may carry a time; we only care about the calendar day.
  const startDate = date.start.slice(0, 10);
  const endDate = (date.end ?? date.start).slice(0, 10);
  return { staff, startDate, endDate };
}

// Re-export the location label lookup so callers building rows have one import.
export { LOCATION_LABELS };
