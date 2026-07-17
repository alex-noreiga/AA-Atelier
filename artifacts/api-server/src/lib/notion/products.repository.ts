// Reads shop inventory from the Notion "inventory" database.
//
// Only rows with the "Show on website" checkbox ticked are returned; stock state
// is NOT filtered here (sold-out variants are still shown, marked unavailable),
// so the shop can render "Sold Out" + a notify option. The whole list is cached
// in memory for a short TTL (inventory changes rarely minute-to-minute); on a
// Notion error we fall back to the cached list rather than failing the request.
//
// Note: photo URLs from Notion-uploaded files are short-lived signed URLs
// (~1h). Because callers fetch through this repository fresh (<= TTL) per
// request, the URLs are valid when delivered to the browser.

import { getInventoryNotionClient, type NotionClient } from "./client.js";
import {
  PRODUCT_PUBLISH_PROPERTY,
  extractCategoryOptions,
  extractIsPublished,
  extractVariant,
  type NotionInventoryDatabaseSchema,
  type NotionInventoryQueryResponse,
  type VariantRecord,
} from "./products.schema.js";
import { logger } from "../logger.js";
import { SIZED_CATEGORY_NAMES, missingOptionValues } from "../config-audit.js";

const PRODUCTS_CACHE_TTL_MS = 60_000;
let cachedVariants: { variants: VariantRecord[]; fetchedAt: number } | null =
  null;
let cachedCategories: { categories: string[]; fetchedAt: number } | null = null;

function assertConfigured(client: NotionClient): void {
  if (!client.databaseId) {
    throw new Error(
      "NOTION_INVENTORY_DATABASE_ID is not configured for the inventory database",
    );
  }
}

async function queryAllPublishedPages(
  client: NotionClient,
): Promise<VariantRecord[]> {
  const variants: VariantRecord[] = [];
  let cursor: string | null = null;

  do {
    const response = await client.fetch(
      `/v1/databases/${client.databaseId}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: {
            property: PRODUCT_PUBLISH_PROPERTY,
            checkbox: { equals: true },
          },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Notion query failed with status ${response.status}`);
    }

    const data = (await response.json()) as NotionInventoryQueryResponse;
    for (const page of data.results) {
      // Defensive: the filter should already exclude unpublished rows.
      if (extractIsPublished(page)) {
        variants.push(extractVariant(page));
      }
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return variants;
}

/**
 * The live "Item Type" select options, in the order the atelier arranged them.
 * Read from the database schema (not derived from the rows) so a newly added
 * option is a real, empty category rather than an invisible one — and so the
 * team's ordering is preserved. Cached for {@link PRODUCTS_CACHE_TTL_MS};
 * falls back to the cached list on error, and to an empty list if we've never
 * fetched it (a missing filter bar must not fail the whole shop).
 */
export async function listCategories(
  client: NotionClient = getInventoryNotionClient(),
): Promise<string[]> {
  assertConfigured(client);

  if (
    cachedCategories &&
    Date.now() - cachedCategories.fetchedAt < PRODUCTS_CACHE_TTL_MS
  ) {
    return cachedCategories.categories;
  }

  try {
    const response = await client.fetch(`/v1/databases/${client.databaseId}`);
    if (!response.ok) {
      throw new Error(
        `Notion database schema fetch failed with status ${response.status}`,
      );
    }

    const schema = (await response.json()) as NotionInventoryDatabaseSchema;
    const categories = extractCategoryOptions(schema);
    // Config-drift guard: warn if a size-chart category name no longer exists in
    // the live "Item Type" options (a Notion rename/removal), which would
    // silently drop the size chart. Advisory only — never fails the request.
    const missingSized = missingOptionValues(SIZED_CATEGORY_NAMES, categories);
    if (missingSized.length > 0) {
      logger.error(
        {
          missing: missingSized,
          sizedCategories: SIZED_CATEGORY_NAMES,
          liveItemTypes: categories,
        },
        'Size-chart "Item Type" values are missing from the live Notion options ' +
          "— a category was likely renamed or removed, so those garments will " +
          "silently lose their size chart. Update SIZED_CATEGORIES in " +
          "artifacts/web-app/src/pages/shop.tsx (or restore the Notion option).",
      );
    }
    cachedCategories = { categories, fetchedAt: Date.now() };
    return categories;
  } catch (error) {
    if (cachedCategories) {
      return cachedCategories.categories;
    }
    throw error;
  }
}

/**
 * List all published inventory variants, newest-Notion-order preserved. Cached
 * for {@link PRODUCTS_CACHE_TTL_MS}; falls back to the cached list on error.
 */
export async function listVariants(
  client: NotionClient = getInventoryNotionClient(),
): Promise<VariantRecord[]> {
  assertConfigured(client);

  if (
    cachedVariants &&
    Date.now() - cachedVariants.fetchedAt < PRODUCTS_CACHE_TTL_MS
  ) {
    return cachedVariants.variants;
  }

  try {
    const variants = await queryAllPublishedPages(client);
    cachedVariants = { variants, fetchedAt: Date.now() };
    return variants;
  } catch (error) {
    if (cachedVariants) {
      return cachedVariants.variants;
    }
    throw error;
  }
}
