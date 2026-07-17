// Reads the optional "Product Categories" database — the data-driven source for
// the shop's category list, ordering, and which categories show a size chart.
//
// Returns `null` when the database is not configured (the env var is unset), so
// the shop service knows to fall back to the inventory "Item Type" options + its
// built-in sized-category list. When configured, returns one record per category
// (id, name, sized flag, sort). Same short-TTL cache + cache-fallback-on-error
// pattern as the inventory repository, since category rows change rarely.

import {
  getProductCategoriesNotionClient,
  type NotionClient,
} from "./client.js";
import {
  extractCategoryRecords,
  type CategoryRecord,
  type NotionCategoriesQueryResponse,
} from "./product-categories.schema.js";

const CATEGORIES_CACHE_TTL_MS = 60_000;
let cachedRecords: { records: CategoryRecord[]; fetchedAt: number } | null =
  null;

async function queryAllCategoryRecords(
  client: NotionClient,
): Promise<CategoryRecord[]> {
  const records: CategoryRecord[] = [];
  let cursor: string | null = null;

  do {
    const response = await client.fetch(
      `/v1/databases/${client.databaseId}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Notion Product Categories query failed with status ${response.status}`,
      );
    }

    const data = (await response.json()) as NotionCategoriesQueryResponse;
    records.push(...extractCategoryRecords(data.results));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return records;
}

/**
 * The shop's category records (id, name, sized flag, sort), or `null` when the
 * "Product Categories" database is not configured
 * (`NOTION_PRODUCT_CATEGORIES_DATABASE_ID` unset) — the caller then falls back to
 * the inventory "Item Type" select. Cached for {@link CATEGORIES_CACHE_TTL_MS};
 * falls back to the cached list on error (a Notion blip must not drop every size
 * chart or empty the shop's filter bar).
 */
export async function listCategoryRecords(
  client: NotionClient = getProductCategoriesNotionClient(),
): Promise<CategoryRecord[] | null> {
  if (!client.databaseId) return null;

  if (
    cachedRecords &&
    Date.now() - cachedRecords.fetchedAt < CATEGORIES_CACHE_TTL_MS
  ) {
    return cachedRecords.records;
  }

  try {
    const records = await queryAllCategoryRecords(client);
    cachedRecords = { records, fetchedAt: Date.now() };
    return records;
  } catch (error) {
    if (cachedRecords) {
      return cachedRecords.records;
    }
    throw error;
  }
}
