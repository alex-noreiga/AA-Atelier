// Reads for the Notion "work distribution" database.
//
// Like the materials and consignment readers, this has nothing worth filtering
// on: the pay panel wants both halves of the book — what is still owed and what
// has been settled — so it is a bounded full-database scan through the shared
// `scanDatabase`. Filtering on a `Paid …` checkbox would fetch one half and then
// need a query per person for the other, against a database that holds one row
// per item the studio has ever made.
//
// The maker roster is a second, separate read: the five `… by` select OPTIONS
// off the database schema, exactly as `fetchLiveOrderStages` reads the order
// stages. Same 60s TTL, same fall-back-to-cached-on-error, and the same reason —
// the atelier adds a maker by typing a name into Notion, not by asking for a
// deploy.

import {
  getWorkDistributionNotionClient,
  assertDatabaseConfigured,
  type NotionClient,
} from "./client.js";
import { scanDatabase } from "./scan.js";
import { notionRequestError } from "./errors.js";
import {
  extractMakerRoster,
  extractWorkDistribution,
  type NotionWorkDistributionPage,
  type WorkDistributionRecord,
} from "./work-distribution.schema.js";

const CACHE_TTL_MS = 60_000;
let cachedRows: { rows: WorkDistributionRecord[]; fetchedAt: number } | null =
  null;
let cachedRoster: { makers: string[]; fetchedAt: number } | null = null;

function assertConfigured(client: NotionClient): void {
  assertDatabaseConfigured(
    client,
    "NOTION_WORK_DISTRIBUTION_DATABASE_ID is not configured for the work distribution database",
  );
}

/** Whether the work-distribution database is configured. Unset ⇒ the dashboard
 * panel says production pay isn't tracked, rather than showing nought owed —
 * which would read as "everyone has been paid". */
export function workDistributionConfigured(
  client: NotionClient = getWorkDistributionNotionClient(),
): boolean {
  return Boolean(client.databaseId);
}

/** Test seam: drop both cached reads so a test's fake client is read afresh. */
export function __resetWorkDistributionCache(): void {
  cachedRows = null;
  cachedRoster = null;
}

/** Every item being made, bounded by {@link scanDatabase}. */
export async function listWorkDistribution(
  client: NotionClient = getWorkDistributionNotionClient(),
): Promise<WorkDistributionRecord[]> {
  assertConfigured(client);

  if (cachedRows && Date.now() - cachedRows.fetchedAt < CACHE_TTL_MS) {
    return cachedRows.rows;
  }

  try {
    const pages = await scanDatabase<NotionWorkDistributionPage>(
      client,
      "work distribution",
    );
    const rows = pages.map(extractWorkDistribution);
    cachedRows = { rows, fetchedAt: Date.now() };
    return rows;
  } catch (error) {
    if (cachedRows) return cachedRows.rows;
    throw error;
  }
}

/**
 * The makers the atelier has configured, from the live `… by` select options.
 *
 * Never hardcoded — see `work-distribution.schema.ts` decision 1. A failed read
 * falls back to the cached roster and, with nothing cached, to an empty one:
 * the service then derives the roster from the assignees it can see on the rows
 * themselves, so a schema hiccup costs a maker with no work their nought row,
 * not the panel its figures.
 */
export async function fetchLiveMakerRoster(
  client: NotionClient = getWorkDistributionNotionClient(),
): Promise<string[]> {
  assertConfigured(client);

  if (cachedRoster && Date.now() - cachedRoster.fetchedAt < CACHE_TTL_MS) {
    return cachedRoster.makers;
  }

  try {
    const response = await client.fetch(`/v1/databases/${client.databaseId}`);
    if (!response.ok) {
      throw await notionRequestError(response, {
        label: "work distribution",
        databaseId: client.databaseId,
        operation: "schema read",
      });
    }
    const data = (await response.json()) as {
      properties?: Record<string, never>;
    };
    const makers = extractMakerRoster(data.properties ?? {});
    cachedRoster = { makers, fetchedAt: Date.now() };
    return makers;
  } catch (error) {
    if (cachedRoster) return cachedRoster.makers;
    throw error;
  }
}
