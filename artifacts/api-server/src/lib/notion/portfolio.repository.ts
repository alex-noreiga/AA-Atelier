// Reads gallery items from the Notion "Portfolio" database.
//
// Only rows with the "Show on website" checkbox ticked are returned. The list is
// cached in memory for a short TTL; on a Notion error we fall back to the cached
// list rather than failing the request.
//
// Note: photo URLs from Notion-uploaded files are short-lived signed URLs
// (~1h), so callers must not cache them longer than that (the route sets a short
// CDN window, mirroring the shop).

import { getPortfolioNotionClient, type NotionClient } from "./client.js";
import {
  PORTFOLIO_PUBLISH_PROPERTY,
  extractCategoryOptions,
  extractIsPublished,
  extractPortfolioItem,
  type NotionPortfolioDatabaseSchema,
  type NotionPortfolioQueryResponse,
  type PortfolioItemRecord,
} from "./portfolio.schema.js";

const PORTFOLIO_CACHE_TTL_MS = 60_000;
let cachedItems: { items: PortfolioItemRecord[]; fetchedAt: number } | null =
  null;
let cachedCategories: { categories: string[]; fetchedAt: number } | null = null;

function assertConfigured(client: NotionClient): void {
  if (!client.databaseId) {
    throw new Error(
      "NOTION_PORTFOLIO_DATABASE_ID is not configured for the portfolio database",
    );
  }
}

async function queryAllPublishedPages(
  client: NotionClient,
): Promise<PortfolioItemRecord[]> {
  const items: PortfolioItemRecord[] = [];
  let cursor: string | null = null;

  do {
    const response = await client.fetch(
      `/v1/databases/${client.databaseId}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: {
            property: PORTFOLIO_PUBLISH_PROPERTY,
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

    const data = (await response.json()) as NotionPortfolioQueryResponse;
    for (const page of data.results) {
      // Defensive: the filter should already exclude unpublished rows.
      if (extractIsPublished(page)) {
        items.push(extractPortfolioItem(page));
      }
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return items;
}

/**
 * List all published portfolio items, Notion order preserved. Cached for
 * {@link PORTFOLIO_CACHE_TTL_MS}; falls back to the cached list on error.
 */
export async function listPortfolioItems(
  client: NotionClient = getPortfolioNotionClient(),
): Promise<PortfolioItemRecord[]> {
  assertConfigured(client);

  if (
    cachedItems &&
    Date.now() - cachedItems.fetchedAt < PORTFOLIO_CACHE_TTL_MS
  ) {
    return cachedItems.items;
  }

  try {
    const items = await queryAllPublishedPages(client);
    cachedItems = { items, fetchedAt: Date.now() };
    return items;
  } catch (error) {
    if (cachedItems) {
      return cachedItems.items;
    }
    throw error;
  }
}

/**
 * The live "Category" select options, in the order the atelier arranged them.
 * Cached for {@link PORTFOLIO_CACHE_TTL_MS}; falls back to the cached list on
 * error, and to an empty list if we've never fetched it (a missing filter bar
 * must not fail the whole gallery).
 */
export async function listCategories(
  client: NotionClient = getPortfolioNotionClient(),
): Promise<string[]> {
  assertConfigured(client);

  if (
    cachedCategories &&
    Date.now() - cachedCategories.fetchedAt < PORTFOLIO_CACHE_TTL_MS
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

    const schema = (await response.json()) as NotionPortfolioDatabaseSchema;
    const categories = extractCategoryOptions(schema);
    cachedCategories = { categories, fetchedAt: Date.now() };
    return categories;
  } catch (error) {
    if (cachedCategories) {
      return cachedCategories.categories;
    }
    throw error;
  }
}
