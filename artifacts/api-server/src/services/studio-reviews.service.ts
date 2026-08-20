// The studio dashboard's review moderation queue, HTTP-agnostic.
//
// Reviews have been captured since post-delivery review capture shipped, and
// until now the app only ever WROTE them: a review landed with `Status = New`
// and someone had to open Notion and promote it by hand for the site to show
// it. This is that same decision, made where the rest of the studio work
// happens — and the read path the site's testimonials always needed to be
// curated against something.
//
// Three things this owns beyond "call Notion":
//
//  1. **Ordering the queue the way it is worked.** Pending reviews come back
//     OLDEST first — the one that has been waiting longest is the one that owes
//     an answer — while the decided list stays newest first, because that one is
//     a record, not a queue.
//  2. **Fetching the photographs, but only where they matter.** A photo lives in
//     the review's page body, so each one costs an extra Notion request. A
//     decision is made on the pending rows, so only those are fetched, capped
//     and rate-limited, and a failure degrades that review to its words rather
//     than failing the queue.
//  3. **Refusing to publish without consent.** The site requires BOTH the
//     atelier's curation and the customer's consent (see `isPublishable`), so
//     publishing a review the customer didn't consent to would write a status
//     the site then declines to honour — a decision that looks taken and does
//     nothing. It is refused with a 409 instead, and the queue shows the reason
//     before the button is pressed.

import {
  listReviewsForModeration,
  findReviewById,
  setReviewStatus,
  listReviewPhotos,
} from "../lib/notion/reviews.repository.js";
import type {
  ReviewModeration,
  StudioReviewRecord,
} from "../lib/notion/reviews.schema.js";
import { logger } from "../lib/logger.js";
import { NotFoundError, ConflictError } from "../lib/errors.js";

/** A review plus the photographs read out of its page body. */
export interface StudioReviewView extends StudioReviewRecord {
  photos: string[];
}

/**
 * How many pending reviews get their photographs fetched. Each is a Notion
 * request, so an unbounded queue would turn one dashboard load into a hundred
 * of them. Well above any plausible backlog — past it the review still shows,
 * with its words and a link into Notion for the pictures.
 */
export const MODERATION_PHOTO_LIMIT = 20;

/** How many photo reads run at once. Notion's published rate limit averages
 * three requests a second, so this stays under it without making the queue feel
 * serial. */
const PHOTO_CONCURRENCY = 3;

/**
 * How many decided reviews are kept for reference. Enough to see what was
 * decided recently and undo a mistake; not so many that the queue turns into a
 * second list to scroll past.
 */
export const DECIDED_REVIEW_LIMIT = 12;

/** Run `task` over `items` a few at a time, preserving order. */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await task(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/** One review's photos, or none if they can't be read. Best-effort: a review
 * the atelier can still read and judge must not disappear because an image
 * fetch failed. */
async function photosFor(reviewId: string): Promise<string[]> {
  try {
    return await listReviewPhotos(reviewId);
  } catch (err) {
    logger.warn(
      { err, reviewId },
      "Failed to read a review's photos; showing the review without them",
    );
    return [];
  }
}

/** The queue as the dashboard renders it. */
export async function getReviewQueue(): Promise<{
  pending: StudioReviewView[];
  decided: StudioReviewView[];
  truncated: boolean;
}> {
  const { records, truncated } = await listReviewsForModeration();

  // The read is newest-first, which is the order the decided list wants and the
  // reverse of the order the queue is worked in.
  const pendingRecords = records
    .filter((review) => review.status === "pending")
    .reverse();
  const decided = records
    .filter((review) => review.status !== "pending")
    .slice(0, DECIDED_REVIEW_LIMIT)
    .map((review) => ({ ...review, photos: [] }));

  const withPhotos = await mapLimited(
    pendingRecords.slice(0, MODERATION_PHOTO_LIMIT),
    PHOTO_CONCURRENCY,
    async (review) => ({ ...review, photos: await photosFor(review.id) }),
  );
  const withoutPhotos = pendingRecords
    .slice(MODERATION_PHOTO_LIMIT)
    .map((review) => ({ ...review, photos: [] }));

  return {
    pending: [...withPhotos, ...withoutPhotos],
    decided,
    truncated,
  };
}

/**
 * Record one moderation decision.
 *
 * The review is read before it is written, for the consent check — and because
 * that read is also what turns a row deleted in Notion since the queue loaded
 * into a 404 rather than a confusing write error. The returned review carries
 * no photos: the caller already has them, and re-reading the page body to echo
 * back what it just displayed would double the cost of every click.
 */
export async function setReviewModeration(
  reviewId: string,
  status: ReviewModeration,
): Promise<StudioReviewView> {
  const review = await findReviewById(reviewId);
  if (!review) {
    throw new NotFoundError("That review no longer exists.");
  }

  if (status === "published" && !review.consentToPublish) {
    throw new ConflictError(
      "This customer didn't agree to their review being published, so it can't go on the site. You can still keep it in the queue or set it aside.",
    );
  }

  const updated = await setReviewStatus(reviewId, status);
  if (!updated) {
    throw new NotFoundError("That review no longer exists.");
  }

  return { ...updated, photos: [] };
}
