// Reads for the Notion "consignment" database.
//
// Like the materials inventory, this has nothing to filter by: the dashboard
// panel wants both halves of the book — what is still on the shop's shelf and
// what has been settled — so it is a bounded full-database scan through the
// shared `scanDatabase`. Filtering on `Settled` would fetch one half and then
// need a second query for the other, for a database that holds one row per
// delivery visit and will stay small for years.
//
// Cached for 60s with fall-back-to-stale-on-error, the same contract as every
// other live Notion read here.

import {
  getConsignmentNotionClient,
  assertDatabaseConfigured,
  type NotionClient,
} from "./client.js";
import { scanDatabase } from "./scan.js";
import {
  extractConsignment,
  type ConsignmentRecord,
  type NotionConsignmentPage,
} from "./consignment.schema.js";

const CACHE_TTL_MS = 60_000;
let cached: { placements: ConsignmentRecord[]; fetchedAt: number } | null =
  null;

function assertConfigured(client: NotionClient): void {
  assertDatabaseConfigured(
    client,
    "NOTION_CONSIGNMENT_DATABASE_ID is not configured for the consignment database",
  );
}

/** Whether the consignment database is configured. Unset ⇒ the dashboard panel
 * says so, rather than showing an empty shelf that reads as "nothing is out on
 * consignment". */
export function consignmentConfigured(
  client: NotionClient = getConsignmentNotionClient(),
): boolean {
  return Boolean(client.databaseId);
}

/** Test seam: drop the cached scan so a test's fake client is read afresh. */
export function __resetConsignmentCache(): void {
  cached = null;
}

/** Every placement, bounded by {@link scanDatabase}. */
export async function listConsignmentPlacements(
  client: NotionClient = getConsignmentNotionClient(),
): Promise<ConsignmentRecord[]> {
  assertConfigured(client);

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.placements;
  }

  try {
    const pages = await scanDatabase<NotionConsignmentPage>(
      client,
      "consignment",
    );
    const placements = pages.map(extractConsignment);
    cached = { placements, fetchedAt: Date.now() };
    return placements;
  } catch (error) {
    if (cached) return cached.placements;
    throw error;
  }
}
