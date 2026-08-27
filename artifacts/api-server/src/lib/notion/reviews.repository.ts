// Review persistence against the dedicated "Reviews" Notion database. Unlike
// the contact-inbox writers, reviews have their own database, so this reads
// `NOTION_REVIEWS_DATABASE_ID` (via `getReviewsNotionClient`) rather than
// reusing the contact client.
//
// Three directions live here. `createReview` is the customer's post-delivery
// submission (which requires the database and throws when it's unset);
// `listPublishedReviews` is the read the site's testimonials render from —
// which deliberately degrades to an empty list instead, since a marketing page
// must not 500 because a Notion database id is missing; and the moderation
// reads/writes at the bottom serve the studio dashboard's queue, which is a
// staff surface and so fails loudly like the write path rather than quietly
// like the marketing one.

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
  REVIEW_EMAIL_PROPERTY,
  type ReviewRow,
} from "./reviews.blocks.js";
import { normalizeEmail } from "../email.js";
import { createPageDroppingUnknownProperties } from "./create-page.js";
import { scanDatabase } from "./scan.js";
import {
  extractProductReviews,
  extractPublishedReviews,
  extractStudioReview,
  extractStudioReviews,
  extractImageUrls,
  MODERATION_STATUS_VALUES,
  REVIEW_STATUS_PUBLISHED,
  type NotionBlockChildrenResponse,
  type NotionReviewPage,
  type NotionReviewsQueryResponse,
  type ProductReviewRecord,
  type PublishedReviewRecord,
  type ReviewModeration,
  type StudioReviewRecord,
} from "./reviews.schema.js";

function assertConfigured(client: NotionClient): void {
  assertDatabaseConfigured(
    client,
    "NOTION_REVIEWS_DATABASE_ID is not configured for the reviews database",
  );
}

/**
 * File one review.
 *
 * Goes through {@link createPageDroppingUnknownProperties} because a shop review
 * names the piece it is about through two properties the atelier adds by hand
 * (`Product` and `Item`), and Notion rejects the WHOLE page over a column it
 * doesn't have. A customer's words are not something to lose to un-done setup:
 * the review is recorded without the link, the page body still says which piece
 * it was, and the warn names the column to add. The cost is that such a review
 * can't be aggregated into that piece's rating until the atelier links it — the
 * right way round, since the alternative loses the review outright.
 */
export async function createReview(
  row: ReviewRow,
  client: NotionClient = getReviewsNotionClient(),
  clientPageId?: string,
): Promise<void> {
  assertConfigured(client);

  await createPageDroppingUnknownProperties(
    client,
    buildReviewProperties(row, clientPageId),
    buildReviewPageBlocks(row),
    "reviews",
  );
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
 * The two gates that make a review public, as a Notion filter. Shared by the
 * testimonial read below and the product-rating read at the bottom of this
 * file, so neither can drift from the other about what "published" means.
 *
 * Deliberately does NOT name the `Product` relation, even though the rating read
 * only wants rows that carry one: a filter naming a property the database lacks
 * is a 400, and `Product` is a column the atelier adds by hand. Rows without one
 * are dropped in the extractor instead, where an absent property simply reads as
 * "not a shop review".
 */
const PUBLISHED_FILTER = {
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
};

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
        filter: PUBLISHED_FILTER,
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

/** Test seam: drop the published-reviews caches between cases. */
export function __resetPublishedReviewsCache(): void {
  cachedPublished = null;
  cachedProductReviews = null;
}

// --- Read side: the ratings shown beside a shop piece ---

let cachedProductReviews: {
  records: ProductReviewRecord[];
  fetchedAt: number;
} | null = null;

/**
 * Every published review that names a shop piece, newest first.
 *
 * A **scan** rather than the single page the testimonials take, because this
 * one is arithmetic: a testimonial strip cut off at 50 rows simply shows the
 * newest 50, while an average cut off at 50 rows is *wrong* — it would drop
 * older reviews out of a piece's count silently as the studio collected more.
 * Bounded by `scanDatabase` like the analytics.
 *
 * Cached and falling back to the cached list on error, like every other live
 * Notion read: this is on the shop's own path, and a Notion blip should cost
 * slightly stale ratings rather than the shop its cards. Returns `[]` when the
 * reviews database isn't configured — a shop without ratings, not an error.
 */
export async function listPublishedProductReviews(
  client: NotionClient = getReviewsNotionClient(),
): Promise<ProductReviewRecord[]> {
  if (!client.databaseId) return [];

  if (
    cachedProductReviews &&
    Date.now() - cachedProductReviews.fetchedAt < PUBLISHED_CACHE_TTL_MS
  ) {
    return cachedProductReviews.records;
  }

  try {
    const pages = await scanDatabase<NotionReviewPage>(client, "reviews", {
      page_size: 100,
      filter: PUBLISHED_FILTER,
      sorts: [{ timestamp: "created_time", direction: "descending" }],
    });
    const records = extractProductReviews(pages);
    cachedProductReviews = { records, fetchedAt: Date.now() };
    return records;
  } catch (error) {
    if (cachedProductReviews) return cachedProductReviews.records;
    throw error;
  }
}

// --- Moderation: the studio dashboard's queue ---

/**
 * How many rows one moderation read covers. Notion's maximum page size, and
 * deliberately a single page: the queue is a working surface for a studio that
 * captures a handful of reviews a month, so paginating the whole database would
 * buy nothing but latency. The caller is told when the read was cut short
 * (`truncated`) so the dashboard can say the list is partial instead of looking
 * complete.
 */
const MODERATION_PAGE_SIZE = 100;

/**
 * The newest reviews, in every state, for the dashboard to triage. Unfiltered
 * on purpose — the moderation state is DERIVED from `Status` (see
 * `reviewModeration`), so a filter would have to enumerate the values that read
 * as pending, and a status the atelier invented would then never appear in the
 * queue at all.
 */
export async function listReviewsForModeration(
  client: NotionClient = getReviewsNotionClient(),
): Promise<{ records: StudioReviewRecord[]; truncated: boolean }> {
  assertConfigured(client);

  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        page_size: MODERATION_PAGE_SIZE,
        sorts: [{ timestamp: "created_time", direction: "descending" }],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Notion review moderation query failed with status ${response.status}`,
    );
  }

  const data = (await response.json()) as NotionReviewsQueryResponse;
  return {
    records: extractStudioReviews(data.results),
    truncated: Boolean(data.has_more),
  };
}

/**
 * Every review this customer has written, newest first — the reviews half of
 * their data export.
 *
 * Reuses the staff projection rather than the public one, and that is the
 * point: a review the atelier never published is still the customer's own
 * words, and an export that showed only the published ones would answer "what
 * do you hold about me?" with "what we chose to show". The service narrows it
 * to what belongs to the customer (the internal Notion link and the
 * email-verified flag are the studio's bookkeeping and stay here).
 */
export async function listReviewsByEmail(
  email: string,
  client: NotionClient = getReviewsNotionClient(),
): Promise<StudioReviewRecord[]> {
  assertConfigured(client);

  const normalized = normalizeEmail(email);
  if (!normalized) return [];

  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        page_size: MODERATION_PAGE_SIZE,
        filter: {
          property: REVIEW_EMAIL_PROPERTY,
          email: { equals: normalized },
        },
        sorts: [{ timestamp: "created_time", direction: "descending" }],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Notion review lookup by email failed with status ${response.status}`,
    );
  }

  const data = (await response.json()) as NotionReviewsQueryResponse;
  return extractStudioReviews(data.results);
}

/** One review by page id, or null when Notion no longer has it (the row may
 * have been deleted since the queue loaded). */
export async function findReviewById(
  reviewId: string,
  client: NotionClient = getReviewsNotionClient(),
): Promise<StudioReviewRecord | null> {
  assertConfigured(client);

  const response = await client.fetch(`/v1/pages/${reviewId}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Notion review read failed with status ${response.status}`);
  }

  return extractStudioReview((await response.json()) as NotionReviewPage);
}

/**
 * Write one review's moderation decision to its `Status`, returning the row as
 * it now stands. Null when Notion doesn't have that page, which the service
 * turns into a 404.
 *
 * **Busts the published cache**, like the availability writes do: publishing a
 * testimonial and then not seeing it on the site for another minute reads as
 * the decision having failed.
 */
export async function setReviewStatus(
  reviewId: string,
  status: ReviewModeration,
  client: NotionClient = getReviewsNotionClient(),
): Promise<StudioReviewRecord | null> {
  assertConfigured(client);

  const response = await client.fetch(`/v1/pages/${reviewId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [REVIEW_STATUS_PROPERTY]: {
          select: { name: MODERATION_STATUS_VALUES[status] },
        },
      },
    }),
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion review status update failed with status ${response.status}: ${errorText}`,
    );
  }

  // Both public reads: publishing a review and then not seeing it — as a
  // testimonial, or in a piece's rating — for another minute reads as the
  // decision having failed.
  cachedPublished = null;
  cachedProductReviews = null;
  return extractStudioReview((await response.json()) as NotionReviewPage);
}

/**
 * The photographs on one review's page, as URLs.
 *
 * Best-effort by contract: a review whose photos can't be read is still a
 * review the atelier can decide on from its words, so a failure here returns an
 * empty list rather than emptying the queue. One page of blocks — a review's
 * body is a quote plus a few images, nowhere near Notion's 100-block page.
 */
export async function listReviewPhotos(
  reviewId: string,
  client: NotionClient = getReviewsNotionClient(),
): Promise<string[]> {
  const response = await client.fetch(
    `/v1/blocks/${reviewId}/children?page_size=100`,
  );
  if (!response.ok) {
    throw new Error(
      `Notion review photo read failed with status ${response.status}`,
    );
  }

  const data = (await response.json()) as NotionBlockChildrenResponse;
  return extractImageUrls(data.results);
}
