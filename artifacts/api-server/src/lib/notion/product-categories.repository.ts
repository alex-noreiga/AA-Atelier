// Reads the optional "Product Categories" database — the data-driven source for
// which shop categories show a size chart.
//
// Returns `null` when the database is not configured (the env var is unset), so
// the shop service knows to fall back to its built-in sized-category list. When
// configured, returns the category names whose "Show size guide" is ticked.
// Same short-TTL cache + cache-fallback-on-error pattern as the inventory
// repository, since category flags change rarely.

import {
  getProductCategoriesNotionClient,
  type NotionClient,
} from "./client.js";
import {
  extractSizedCategoryNames,
  type NotionCategoriesQueryResponse,
} from "./product-categories.schema.js";

const CATEGORIES_CACHE_TTL_MS = 60_000;
let cachedSizedNames: { names: string[]; fetchedAt: number } | null = null;

async function queryAllSizedNames(client: NotionClient): Promise<string[]> {
  const names: string[] = [];
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
    names.push(...extractSizedCategoryNames(data.results));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return names;
}

/**
 * The category `Name`s whose "Show size guide" checkbox is ticked, or `null` when
 * the "Product Categories" database is not configured
 * (`NOTION_PRODUCT_CATEGORIES_DATABASE_ID` unset) — the caller then uses its
 * built-in fallback. Cached for {@link CATEGORIES_CACHE_TTL_MS}; falls back to the
 * cached list on error (a Notion blip must not drop every size chart).
 */
export async function listSizedCategoryNames(
  client: NotionClient = getProductCategoriesNotionClient(),
): Promise<string[] | null> {
  if (!client.databaseId) return null;

  if (
    cachedSizedNames &&
    Date.now() - cachedSizedNames.fetchedAt < CATEGORIES_CACHE_TTL_MS
  ) {
    return cachedSizedNames.names;
  }

  try {
    const names = await queryAllSizedNames(client);
    cachedSizedNames = { names, fetchedAt: Date.now() };
    return names;
  } catch (error) {
    if (cachedSizedNames) {
      return cachedSizedNames.names;
    }
    throw error;
  }
}
