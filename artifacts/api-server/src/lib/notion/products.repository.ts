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

import {
  getInventoryNotionClient,
  assertDatabaseConfigured,
  type NotionClient,
} from "./client.js";
import {
  PRODUCT_PUBLISH_PROPERTY,
  extractIsPublished,
  extractVariant,
  type NotionInventoryQueryResponse,
  type VariantRecord,
} from "./products.schema.js";

const PRODUCTS_CACHE_TTL_MS = 60_000;
let cachedVariants: { variants: VariantRecord[]; fetchedAt: number } | null =
  null;

function assertConfigured(client: NotionClient): void {
  assertDatabaseConfigured(
    client,
    "NOTION_INVENTORY_DATABASE_ID is not configured for the inventory database",
  );
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
 * List all published inventory variants, newest-Notion-order preserved. Cached
 * for {@link PRODUCTS_CACHE_TTL_MS}; falls back to the cached list on error.
 *
 * `fresh` skips the cache READ (the result still refreshes it). The back-in-stock
 * sweep passes it: the whole point of that run is to act on a stock change the
 * atelier just made, and a cached read could report the piece still sold out for
 * up to a minute after they restocked it — which on a manual run reads as the
 * feature being broken.
 */
export async function listVariants(
  client: NotionClient = getInventoryNotionClient(),
  options: { fresh?: boolean } = {},
): Promise<VariantRecord[]> {
  assertConfigured(client);

  if (
    !options.fresh &&
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
