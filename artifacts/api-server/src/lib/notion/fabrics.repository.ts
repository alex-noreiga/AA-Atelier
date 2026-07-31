// Reads the optional "Fabrics" database — the atelier-editable swatch palette for
// the custom-order intake form's visual fabric selector.
//
// Returns `[]` when the database is not configured (`NOTION_FABRICS_DATABASE_ID`
// unset), so the order form degrades to its free-text description field. When
// configured, returns one record per published swatch. Same short-TTL cache +
// cache-fallback-on-error pattern as the other live-read repositories, since
// swatch rows change rarely.
//
// Note: `Swatch` photo URLs from Notion-uploaded files are short-lived signed URLs
// (~1h). Because callers fetch through this repository fresh (<= TTL) per request,
// the URLs are valid when delivered to the browser.

import { getFabricsNotionClient, type NotionClient } from "./client.js";
import {
  FABRIC_PUBLISH_PROPERTY,
  extractIsPublished,
  extractFabricRecords,
  type FabricRecord,
  type NotionFabricsQueryResponse,
} from "./fabrics.schema.js";

const FABRICS_CACHE_TTL_MS = 60_000;
let cachedRecords: { records: FabricRecord[]; fetchedAt: number } | null = null;

async function queryAllPublishedFabrics(
  client: NotionClient,
): Promise<FabricRecord[]> {
  const pages = [];
  let cursor: string | null = null;

  do {
    const response = await client.fetch(
      `/v1/databases/${client.databaseId}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: {
            property: FABRIC_PUBLISH_PROPERTY,
            checkbox: { equals: true },
          },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Notion Fabrics query failed with status ${response.status}`,
      );
    }

    const data = (await response.json()) as NotionFabricsQueryResponse;
    // Defensive: the filter should already exclude unpublished rows.
    pages.push(...data.results.filter(extractIsPublished));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return extractFabricRecords(pages);
}

/**
 * The atelier's published fabric swatches, or `[]` when the "Fabrics" database is
 * not configured (`NOTION_FABRICS_DATABASE_ID` unset) — the order form then shows
 * only its free-text description. Cached for {@link FABRICS_CACHE_TTL_MS}; falls
 * back to the cached list on error (a Notion blip must not empty the picker).
 */
export async function listFabricRecords(
  client: NotionClient = getFabricsNotionClient(),
): Promise<FabricRecord[]> {
  if (!client.databaseId) return [];

  if (
    cachedRecords &&
    Date.now() - cachedRecords.fetchedAt < FABRICS_CACHE_TTL_MS
  ) {
    return cachedRecords.records;
  }

  try {
    const records = await queryAllPublishedFabrics(client);
    cachedRecords = { records, fetchedAt: Date.now() };
    return records;
  } catch (error) {
    if (cachedRecords) {
      return cachedRecords.records;
    }
    throw error;
  }
}
