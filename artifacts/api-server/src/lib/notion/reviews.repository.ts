// Review persistence against the dedicated "Reviews" Notion database. Unlike
// the contact-inbox writers, reviews have their own database, so this reads
// `NOTION_REVIEWS_DATABASE_ID` (via `getReviewsNotionClient`) rather than
// reusing the contact client.
//
// Two directions live here. `createReview` is the customer's post-delivery
// submission (which requires the database and throws when it's unset), and
// `listPublishedReviews` is the read the site's testimonials render from —
// which deliberately degrades to an empty list instead, since a marketing page
// must not 500 because a Notion database id is missing.

import {
  getReviewsNotionClient,
  assertDatabaseConfigured,
  type NotionClient,
} from "./client.js";
import {
  buildReviewProperties,
  buildReviewPageBlocks,
  REVIEW_STATUS_PROPERTY,
  REVIEW_CONSENT_PROPERTY,
  type ReviewRow,
} from "./reviews.blocks.js";
import {
  extractPublishedReviews,
  REVIEW_STATUS_PUBLISHED,
  type NotionReviewsQueryResponse,
  type PublishedReviewRecord,
} from "./reviews.schema.js";

function assertConfigured(client: NotionClient): void {
  assertDatabaseConfigured(
    client,
    "NOTION_REVIEWS_DATABASE_ID is not configured for the reviews database",
  );
}

export async function createReview(
  row: ReviewRow,
  client: NotionClient = getReviewsNotionClient(),
  clientPageId?: string,
): Promise<void> {
  assertConfigured(client);

  const body: Record<string, unknown> = {
    parent: { database_id: client.databaseId },
    properties: buildReviewProperties(row, clientPageId),
    children: buildReviewPageBlocks(row),
  };

  const response = await client.fetch("/v1/pages", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion review creation failed with status ${response.status}: ${errorText}`,
    );
  }
}

// --- Read side: the curated testimonials the site shows ---

const PUBLISHED_CACHE_TTL_MS = 60_000;

/**
 * How many published reviews one fetch pulls, and therefore the ceiling any
 * caller can be served from the cache. Matches the contract's `limit` maximum
 * on GET /reviews, so every allowed request is answerable from a single stored
 * page and a large `limit` can never bypass the cache.
 */
const MAX_PUBLISHED_REVIEWS = 50;
let cachedPublished: {
  records: PublishedReviewRecord[];
  fetchedAt: number;
} | null = null;

/**
 * Query the reviews database for the rows the atelier has published AND the
 * customer consented to publish, newest first. Both gates are pushed into the
 * Notion filter so an unpublished review never crosses the wire; the pure
 * extractor re-checks them, so neither layer alone can leak one.
 */
async function queryPublishedReviews(
  client: NotionClient,
  limit: number,
): Promise<PublishedReviewRecord[]> {
  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        page_size: limit,
        filter: {
          and: [
            {
              property: REVIEW_STATUS_PROPERTY,
              select: { equals: REVIEW_STATUS_PUBLISHED },
            },
            {
              property: REVIEW_CONSENT_PROPERTY,
              checkbox: { equals: true },
            },
          ],
        },
        sorts: [{ timestamp: "created_time", direction: "descending" }],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Notion published-reviews query failed with status ${response.status}`,
    );
  }

  const data = (await response.json()) as NotionReviewsQueryResponse;
  return extractPublishedReviews(data.results);
}

/**
 * The published testimonials, newest first, capped at `limit`.
 *
 * Deliberately unpaginated: the site renders a handful of testimonials, so one
 * page of results is the whole feature. Cached for
 * {@link PUBLISHED_CACHE_TTL_MS} and falling back to the cached list on error,
 * like the inventory and category reads — a Notion blip must not blank the
 * home page's testimonials. Returns `[]` when the database isn't configured.
 *
 * The cache is keyed on nothing but time, so it is only correct because every
 * caller asks for the same `limit`; a smaller `limit` is applied to the cached
 * list on the way out rather than re-fetching.
 */
export async function listPublishedReviews(
  limit: number,
  client: NotionClient = getReviewsNotionClient(),
): Promise<PublishedReviewRecord[]> {
  if (!client.databaseId) return [];

  if (
    cachedPublished &&
    Date.now() - cachedPublished.fetchedAt < PUBLISHED_CACHE_TTL_MS
  ) {
    return cachedPublished.records.slice(0, limit);
  }

  try {
    const records = await queryPublishedReviews(client, MAX_PUBLISHED_REVIEWS);
    cachedPublished = { records, fetchedAt: Date.now() };
    return records.slice(0, limit);
  } catch (error) {
    if (cachedPublished) return cachedPublished.records.slice(0, limit);
    throw error;
  }
}

/** Test seam: drop the published-reviews cache between cases. */
export function __resetPublishedReviewsCache(): void {
  cachedPublished = null;
}
