// Reads for the Notion "Category Pay Splits" database.
//
// One row per product category, so this is a handful of rows that change a
// couple of times a year — a bounded scan with the usual 60s TTL and
// fall-back-to-stale-on-error, like every other live Notion read here.
//
// Returned as a map keyed on the Notion page id, because that is what a work
// distribution row's `Category` relation holds. Joining on the id rather than
// on the category NAME is the same call `products.service` makes against the
// Product Categories database: renaming "Dress" in Notion then costs nothing,
// where a name join would silently stop paying anyone for a dress.

import {
  getPaySplitsNotionClient,
  assertDatabaseConfigured,
  type NotionClient,
} from "./client.js";
import { scanDatabase } from "./scan.js";
import {
  extractPaySplit,
  type NotionPaySplitPage,
  type PaySplitRecord,
} from "./pay-splits.schema.js";

const CACHE_TTL_MS = 60_000;
let cached: { splits: PaySplitRecord[]; fetchedAt: number } | null = null;

function assertConfigured(client: NotionClient): void {
  assertDatabaseConfigured(
    client,
    "NOTION_PAY_SPLITS_DATABASE_ID is not configured for the Category Pay Splits database",
  );
}

/** Whether the pay-splits database is configured. Unset ⇒ nothing can be
 * attributed, and the panel says which of the two databases is missing. */
export function paySplitsConfigured(
  client: NotionClient = getPaySplitsNotionClient(),
): boolean {
  return Boolean(client.databaseId);
}

/** Test seam: drop the cached scan so a test's fake client is read afresh. */
export function __resetPaySplitsCache(): void {
  cached = null;
}

/** Every category's pay split, bounded by {@link scanDatabase}. */
export async function listPaySplits(
  client: NotionClient = getPaySplitsNotionClient(),
): Promise<PaySplitRecord[]> {
  assertConfigured(client);

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.splits;
  }

  try {
    const pages = await scanDatabase<NotionPaySplitPage>(
      client,
      "Category Pay Splits",
    );
    const splits = pages.map(extractPaySplit);
    cached = { splits, fetchedAt: Date.now() };
    return splits;
  } catch (error) {
    if (cached) return cached.splits;
    throw error;
  }
}
