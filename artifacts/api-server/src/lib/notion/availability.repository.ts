// Reads each staff member's weekly working hours and time-off from the Notion
// "Staff Availability" database. Only "Active" rows are read; each is sorted
// into weekly-hours or time-off by its "Kind". The result is cached in memory
// for a short TTL (the schedule changes rarely minute-to-minute); on a Notion
// error we fall back to the cached value rather than failing the request —
// mirroring `products.repository`.

import { getAvailabilityNotionClient, type NotionClient } from "./client.js";
import {
  AVAIL_ACTIVE_PROPERTY,
  AVAIL_KIND_TIME_OFF,
  AVAIL_KIND_WEEKLY,
  extractKind,
  extractTimeOff,
  extractWeeklyHours,
  type NotionAvailabilityQueryResponse,
} from "./availability.schema.js";
import type { TimeOff, WeeklyHours } from "../appointments/availability.js";

export interface AvailabilityConfig {
  weeklyHours: WeeklyHours[];
  timeOff: TimeOff[];
}

const AVAILABILITY_CACHE_TTL_MS = 60_000;
let cached: { config: AvailabilityConfig; fetchedAt: number } | null = null;

function assertConfigured(client: NotionClient): void {
  if (!client.databaseId) {
    throw new Error(
      "NOTION_AVAILABILITY_DATABASE_ID is not configured for the availability database",
    );
  }
}

async function queryAllActiveRows(
  client: NotionClient,
): Promise<AvailabilityConfig> {
  const weeklyHours: WeeklyHours[] = [];
  const timeOff: TimeOff[] = [];
  let cursor: string | null = null;

  do {
    const response = await client.fetch(
      `/v1/databases/${client.databaseId}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: {
            property: AVAIL_ACTIVE_PROPERTY,
            checkbox: { equals: true },
          },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Notion availability query failed with status ${response.status}`,
      );
    }

    const data = (await response.json()) as NotionAvailabilityQueryResponse;
    for (const page of data.results) {
      const kind = extractKind(page);
      if (kind === AVAIL_KIND_WEEKLY) {
        const hours = extractWeeklyHours(page);
        if (hours) weeklyHours.push(hours);
      } else if (kind === AVAIL_KIND_TIME_OFF) {
        const off = extractTimeOff(page);
        if (off) timeOff.push(off);
      }
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return { weeklyHours, timeOff };
}

/**
 * The atelier's weekly hours + time-off. Cached for
 * {@link AVAILABILITY_CACHE_TTL_MS}; on a Notion error, falls back to the cached
 * value, or rethrows if nothing has been fetched yet.
 */
export async function getAvailabilityConfig(
  client: NotionClient = getAvailabilityNotionClient(),
): Promise<AvailabilityConfig> {
  assertConfigured(client);

  if (cached && Date.now() - cached.fetchedAt < AVAILABILITY_CACHE_TTL_MS) {
    return cached.config;
  }

  try {
    const config = await queryAllActiveRows(client);
    cached = { config, fetchedAt: Date.now() };
    return config;
  } catch (error) {
    if (cached) return cached.config;
    throw error;
  }
}
