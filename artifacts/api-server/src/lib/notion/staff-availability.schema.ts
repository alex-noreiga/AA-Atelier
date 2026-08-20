// Notion schema mapping for the "Staff Availability" database — the standing
// working hours the slot calculator reads as its positive availability grid.
//
// One row is one recurring block of hours for one person: who, which calendar,
// which weekdays, from when to when, and which locations may be booked in it.
// It replaced a Google Sheet of the same six columns; the shape survived the
// move, the vendor didn't (see CLAUDE.md → "Staff availability, edited on the
// dashboard").
//
// Notion has no time-of-day property, so `Start`/`End` are rich_text holding
// 24-hour `HH:MM`. That is deliberate: it reads as a time in the Notion UI and
// parses with the same `parseTimeToMinutes` every other clock value goes
// through. Storing minutes-past-midnight as a number would be tidier for the
// app and unreadable for the atelier.
//
// As everywhere in the Notion adapter, the property *types* here must match the
// live schema, not the property name (see `.agents/memory/notion-status-filters.md`).

import type { ScheduleEntry } from "../appointments/staff.js";

// Live-schema property names (a Notion rename is a one-line change here).
export const AVAILABILITY_STAFF_PROPERTY = "Staff"; // title
export const AVAILABILITY_EMAIL_PROPERTY = "Calendar Email"; // email
export const AVAILABILITY_WEEKDAYS_PROPERTY = "Weekdays"; // multi_select
export const AVAILABILITY_START_PROPERTY = "Start"; // rich_text — "10:00"
export const AVAILABILITY_END_PROPERTY = "End"; // rich_text — "17:00"
export const AVAILABILITY_LOCATIONS_PROPERTY = "Locations"; // multi_select

/** One row: a schedule entry plus the page id the editor updates/removes by. */
export interface StaffAvailabilityRecord extends ScheduleEntry {
  id: string;
}

// --- Raw Notion payload typing (only the property types we read) ---

type NotionPropertyValue =
  | { type: "title"; title: Array<{ plain_text: string }> }
  | { type: "rich_text"; rich_text: Array<{ plain_text: string }> }
  | { type: "email"; email: string | null }
  | { type: "multi_select"; multi_select: Array<{ name: string }> };

export interface NotionAvailabilityPage {
  id: string;
  properties: Record<string, NotionPropertyValue | undefined>;
}

export interface NotionAvailabilityQueryResponse {
  results: NotionAvailabilityPage[];
  has_more: boolean;
  next_cursor: string | null;
}

// --- Extractors (narrow by the runtime `type` discriminator) ---

function extractText(page: NotionAvailabilityPage, name: string): string {
  const property = page.properties[name];
  if (property?.type === "title") {
    return property.title
      .map((t) => t.plain_text)
      .join("")
      .trim();
  }
  if (property?.type === "rich_text") {
    return property.rich_text
      .map((t) => t.plain_text)
      .join("")
      .trim();
  }
  return "";
}

function extractEmail(page: NotionAvailabilityPage, name: string): string {
  const property = page.properties[name];
  if (property?.type === "email") return property.email?.trim() ?? "";
  // Tolerated so an atelier who typed the address into a text property still
  // gets a working calendar rather than a silently unbookable staff member.
  return extractText(page, name);
}

function extractMultiSelect(
  page: NotionAvailabilityPage,
  name: string,
): string[] {
  const property = page.properties[name];
  if (property?.type !== "multi_select") return [];
  return property.multi_select.map((option) => option.name);
}

/** Map one row to a record. Separate so a write can echo back what it saved. */
export function extractAvailabilityRecord(
  page: NotionAvailabilityPage,
): StaffAvailabilityRecord {
  return {
    id: page.id,
    staff: extractText(page, AVAILABILITY_STAFF_PROPERTY),
    email: extractEmail(page, AVAILABILITY_EMAIL_PROPERTY),
    weekdays: extractMultiSelect(page, AVAILABILITY_WEEKDAYS_PROPERTY),
    start: extractText(page, AVAILABILITY_START_PROPERTY),
    end: extractText(page, AVAILABILITY_END_PROPERTY),
    locations: extractMultiSelect(page, AVAILABILITY_LOCATIONS_PROPERTY),
  };
}

/**
 * Map the "Staff Availability" rows into domain records. Rows with an empty
 * `Staff` are dropped — a block of hours belonging to nobody can't be assigned
 * to a calendar, and it would show in the dashboard's editor as a nameless row.
 * Everything else is left as stored: `buildSchedule` decides what is bookable.
 */
export function extractAvailabilityRecords(
  pages: NotionAvailabilityPage[],
): StaffAvailabilityRecord[] {
  return pages
    .map(extractAvailabilityRecord)
    .filter((record) => record.staff.length > 0);
}
