// Reads the staff working-hours schedule from a Google Sheet the atelier edits.
// The sheet is the live, no-deploy home for standing hours: a plain grid the
// team edits like any spreadsheet, picked up here within a short TTL.
//
// Columns (fixed order; row 1 is a header, data from row 2 → range `A2:F`):
//   A Staff | B Email | C Day | D Start | E End | F Locations
//
// The service account reads the sheet as *itself* (the sheet is shared with its
// email), so no domain-wide delegation is needed here. Cached in memory for a
// short TTL, falling back to the cached value on error — mirroring
// `products.repository.ts`.

import { getGoogleSheetsClient, type GoogleSheetsClient } from "./client.js";
import {
  parseScheduleRows,
  type ParsedSchedule,
  type ScheduleRow,
} from "../appointments/staff.js";

const DEFAULT_RANGE = "A2:F";
const SCHEDULE_CACHE_TTL_MS = 60_000;
let cached: { schedule: ParsedSchedule; fetchedAt: number } | null = null;

interface SheetValuesResponse {
  values?: string[][];
}

function assertConfigured(): string {
  const sheetId = process.env.APPOINTMENT_SHEET_ID;
  if (!sheetId) {
    throw new Error("APPOINTMENT_SHEET_ID environment variable is not set");
  }
  return sheetId;
}

/** Map the raw 2-D cell values (positional columns) to typed schedule rows. */
function toRows(values: string[][]): ScheduleRow[] {
  return values.map((row) => ({
    staff: row[0] ?? "",
    email: row[1] ?? "",
    day: row[2] ?? "",
    start: row[3] ?? "",
    end: row[4] ?? "",
    locations: row[5] ?? "",
  }));
}

async function fetchSchedule(
  client: GoogleSheetsClient,
): Promise<ParsedSchedule> {
  const sheetId = assertConfigured();
  const range = process.env.APPOINTMENT_SHEET_RANGE || DEFAULT_RANGE;

  const response = await client.fetch(
    `/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}`,
  );
  if (!response.ok) {
    throw new Error(
      `Google Sheets values fetch failed with status ${response.status}`,
    );
  }

  const data = (await response.json()) as SheetValuesResponse;
  return parseScheduleRows(toRows(data.values ?? []));
}

/**
 * The parsed schedule (weekly hours + staff→email map). Cached for
 * {@link SCHEDULE_CACHE_TTL_MS}; on a Sheets error, falls back to the cached
 * value, or rethrows if nothing has been fetched yet.
 */
export async function getStaffSchedule(
  client: GoogleSheetsClient = getGoogleSheetsClient(),
): Promise<ParsedSchedule> {
  if (cached && Date.now() - cached.fetchedAt < SCHEDULE_CACHE_TTL_MS) {
    return cached.schedule;
  }
  try {
    const schedule = await fetchSchedule(client);
    cached = { schedule, fetchedAt: Date.now() };
    return schedule;
  } catch (error) {
    if (cached) return cached.schedule;
    throw error;
  }
}

/** The booking calendar email for a staff member, or undefined if not in the sheet. */
export async function calendarEmailFor(
  staffName: string,
  client: GoogleSheetsClient = getGoogleSheetsClient(),
): Promise<string | undefined> {
  return (await getStaffSchedule(client)).calendars.get(staffName);
}
