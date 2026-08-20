// Reads and writes the "Staff Availability" database — the atelier's standing
// working hours, edited on the studio dashboard.
//
// The read keeps the short-TTL cache + fall-back-to-cache-on-error shape the
// Google Sheet it replaced had (and every other live Notion read here has): the
// schedule changes rarely, but it is read on every availability query and every
// booking re-check, so a Notion blip must not empty the calendar. The writes
// **bust that cache**, because the atelier editing hours and then not seeing
// them for another minute reads as the save having failed.

import {
  getStaffAvailabilityNotionClient,
  assertDatabaseConfigured,
  type NotionClient,
} from "./client.js";
import {
  extractAvailabilityRecord,
  extractAvailabilityRecords,
  AVAILABILITY_STAFF_PROPERTY,
  type NotionAvailabilityPage,
  type NotionAvailabilityQueryResponse,
  type StaffAvailabilityRecord,
} from "./staff-availability.schema.js";
import { buildStaffAvailabilityProperties } from "./staff-availability.blocks.js";
import type { ScheduleEntry } from "../appointments/staff.js";

const AVAILABILITY_CACHE_TTL_MS = 60_000;
let cached: { records: StaffAvailabilityRecord[]; fetchedAt: number } | null =
  null;

function assertConfigured(client: NotionClient): void {
  assertDatabaseConfigured(
    client,
    "NOTION_STAFF_AVAILABILITY_DATABASE_ID is not configured for the staff availability database",
  );
}

/** Test seam — the module-level cache would otherwise leak between tests. */
export function __resetStaffAvailabilityCache(): void {
  cached = null;
}

async function queryAllRecords(
  client: NotionClient,
): Promise<StaffAvailabilityRecord[]> {
  const records: StaffAvailabilityRecord[] = [];
  let cursor: string | null = null;

  do {
    const response = await client.fetch(
      `/v1/databases/${client.databaseId}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          page_size: 100,
          sorts: [
            { property: AVAILABILITY_STAFF_PROPERTY, direction: "ascending" },
          ],
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Notion Staff Availability query failed with status ${response.status}`,
      );
    }

    const data = (await response.json()) as NotionAvailabilityQueryResponse;
    records.push(...extractAvailabilityRecords(data.results));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return records;
}

/**
 * Every block of working hours on record. Cached for
 * {@link AVAILABILITY_CACHE_TTL_MS}; on a Notion error, falls back to the
 * cached list, or rethrows if nothing has been read yet — the same contract the
 * Sheets adapter had, and the reason a Notion outage degrades booking to
 * "slightly stale hours" rather than "no hours at all".
 */
export async function listStaffAvailability(
  client: NotionClient = getStaffAvailabilityNotionClient(),
): Promise<StaffAvailabilityRecord[]> {
  assertConfigured(client);

  if (cached && Date.now() - cached.fetchedAt < AVAILABILITY_CACHE_TTL_MS) {
    return cached.records;
  }

  try {
    const records = await queryAllRecords(client);
    cached = { records, fetchedAt: Date.now() };
    return records;
  } catch (error) {
    if (cached) return cached.records;
    throw error;
  }
}

/** Create one block of hours; returns it as stored, for the editor to render. */
export async function createStaffAvailability(
  entry: ScheduleEntry,
  client: NotionClient = getStaffAvailabilityNotionClient(),
): Promise<StaffAvailabilityRecord> {
  assertConfigured(client);

  const response = await client.fetch("/v1/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: client.databaseId },
      properties: buildStaffAvailabilityProperties(entry),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion staff availability creation failed with status ${response.status}: ${errorText}`,
    );
  }

  cached = null;
  return extractAvailabilityRecord(
    (await response.json()) as NotionAvailabilityPage,
  );
}

/**
 * Replace one block of hours. The whole entry is written, so a property the
 * atelier cleared in the editor is cleared here too. Returns null when Notion
 * doesn't have that page, which the service turns into a 404 — the row may have
 * been deleted in Notion since the editor loaded it.
 */
export async function updateStaffAvailability(
  entryId: string,
  entry: ScheduleEntry,
  client: NotionClient = getStaffAvailabilityNotionClient(),
): Promise<StaffAvailabilityRecord | null> {
  assertConfigured(client);

  const response = await client.fetch(`/v1/pages/${entryId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: buildStaffAvailabilityProperties(entry),
    }),
  });

  if (response.status === 404) return null;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion staff availability update failed with status ${response.status}: ${errorText}`,
    );
  }

  cached = null;
  return extractAvailabilityRecord(
    (await response.json()) as NotionAvailabilityPage,
  );
}

/**
 * Remove one block of hours. Notion has no delete — a page is archived, which
 * is what its own UI's "Delete" does, so the row goes to the workspace trash and
 * can be restored there. Returns false when the page doesn't exist (a 404 for
 * the caller); archiving an already-archived page is a success, so a repeated
 * delete is idempotent.
 */
export async function archiveStaffAvailability(
  entryId: string,
  client: NotionClient = getStaffAvailabilityNotionClient(),
): Promise<boolean> {
  assertConfigured(client);

  const response = await client.fetch(`/v1/pages/${entryId}`, {
    method: "PATCH",
    body: JSON.stringify({ archived: true }),
  });

  if (response.status === 404) return false;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion staff availability delete failed with status ${response.status}: ${errorText}`,
    );
  }

  cached = null;
  return true;
}
