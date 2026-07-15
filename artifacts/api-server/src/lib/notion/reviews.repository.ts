// Review persistence + lookup against the Notion "Website Reviews" database.
//
// The read path lists only PUBLISHED rows (the atelier's moderation gate),
// newest first, and caches the list in memory for a short TTL (reviews change
// rarely minute-to-minute); on a Notion error it falls back to the cached list
// rather than failing the request — the same shape as the shop products
// repository. The write path files a new, unpublished review.

import { getReviewsNotionClient, type NotionClient } from "./client.js";
import { buildReviewProperties, type ReviewRow } from "./reviews.blocks.js";
import {
  REVIEW_PUBLISH_PROPERTY,
  extractIsPublished,
  extractReview,
  type NotionReviewsQueryResponse,
  type ReviewRecord,
} from "./reviews.schema.js";

const REVIEWS_CACHE_TTL_MS = 60_000;
let cachedReviews: { reviews: ReviewRecord[]; fetchedAt: number } | null = null;

function assertConfigured(client: NotionClient): void {
  if (!client.databaseId) {
    throw new Error(
      "NOTION_REVIEWS_DATABASE_ID is not configured for the reviews database",
    );
  }
}

async function queryAllPublishedPages(
  client: NotionClient,
): Promise<ReviewRecord[]> {
  const reviews: ReviewRecord[] = [];
  let cursor: string | null = null;

  do {
    const response = await client.fetch(
      `/v1/databases/${client.databaseId}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: {
            property: REVIEW_PUBLISH_PROPERTY,
            checkbox: { equals: true },
          },
          sorts: [{ timestamp: "created_time", direction: "descending" }],
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Notion query failed with status ${response.status}`);
    }

    const data = (await response.json()) as NotionReviewsQueryResponse;
    for (const page of data.results) {
      // Defensive: the filter should already exclude unpublished rows.
      if (extractIsPublished(page)) {
        reviews.push(extractReview(page));
      }
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return reviews;
}

/**
 * List all published reviews, newest first. Cached for
 * {@link REVIEWS_CACHE_TTL_MS}; falls back to the cached list on error.
 */
export async function listPublishedReviews(
  client: NotionClient = getReviewsNotionClient(),
): Promise<ReviewRecord[]> {
  assertConfigured(client);

  if (
    cachedReviews &&
    Date.now() - cachedReviews.fetchedAt < REVIEWS_CACHE_TTL_MS
  ) {
    return cachedReviews.reviews;
  }

  try {
    const reviews = await queryAllPublishedPages(client);
    cachedReviews = { reviews, fetchedAt: Date.now() };
    return reviews;
  } catch (error) {
    if (cachedReviews) {
      return cachedReviews.reviews;
    }
    throw error;
  }
}

/** File a new (unpublished) review. */
export async function createReview(
  row: ReviewRow,
  client: NotionClient = getReviewsNotionClient(),
): Promise<void> {
  assertConfigured(client);

  const body: Record<string, unknown> = {
    parent: { database_id: client.databaseId },
    properties: buildReviewProperties(row),
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
