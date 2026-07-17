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
  extractStatusOptions,
  extractIsPublished,
  extractVariant,
  type NotionInventoryDatabaseSchema,
  type NotionInventoryQueryResponse,
  type VariantRecord,
} from "./products.schema.js";

const PRODUCTS_CACHE_TTL_MS = 60_000;
let cachedVariants: { variants: VariantRecord[]; fetchedAt: number } | null =
  null;

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
 * The live "Status" option list from the inventory database schema. Uncached —
 * this is used only by the nightly config-drift check (config-check.service) to
 * verify STATUS_IN_STOCK still exists, not the hot shop path.
 */
export async function fetchInventoryOptionSets(
  client: NotionClient = getInventoryNotionClient(),
): Promise<{ statusOptions: string[] }> {
  assertConfigured(client);
  const response = await client.fetch(`/v1/databases/${client.databaseId}`);
  if (!response.ok) {
    throw new Error(
      `Notion database schema fetch failed with status ${response.status}`,
    );
  }
  const schema = (await response.json()) as NotionInventoryDatabaseSchema;
  return { statusOptions: extractStatusOptions(schema) };
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
