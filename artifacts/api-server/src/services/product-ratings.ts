// Turning published reviews into the rating shown beside a shop piece. Pure (no
// I/O), so the arithmetic and the grouping can be unit-tested directly; the
// reads that feed it live in `products.service.ts`.
//
// The join runs id → card, not name → name. A review names the INVENTORY ROW it
// was left against (its `Product` relation), and a shop card is either that row
// or the `Website Group` it belongs to — so `shopCardId` is what maps one to the
// other. Matching by name instead would break the day the atelier renamed a
// piece, exactly as it does for the back-in-stock requests.

import type { ProductReviewRecord } from "../lib/notion/reviews.schema.js";
import type {
  ProductRatingSummary,
  ProductRecord,
} from "../lib/notion/products.schema.js";

/**
 * How many reviews are quoted on a card. The shop list is one edge-cached
 * payload serving every visitor, so it carries a taste of each piece's reviews
 * rather than the whole history — the average and the count already say how many
 * there are. Newest first, so a piece's card moves as customers write in.
 */
export const QUOTED_REVIEWS_PER_PRODUCT = 3;

/**
 * Summarize the reviews attached to each shop card, keyed by card id.
 *
 * A grouped card pools its variants' reviews, because that is the piece a
 * shopper is looking at: someone reading "Aurora Soaker" wants what buyers of
 * the Aurora Soaker thought, not what buyers of the pink one alone did.
 *
 * A review naming several inventory rows (nothing writes that today, but the
 * relation permits it) counts once per CARD, so a review of two colourways of
 * the same piece can't inflate that piece's count — and one review spanning two
 * different pieces legitimately counts for both.
 *
 * A review whose piece has no card in the payload — unpublished since, or sold
 * from a row the shop no longer lists — is silently dropped: there is nothing
 * for it to be shown beside.
 */
export function summarizeProductRatings(
  products: ProductRecord[],
  reviews: ProductReviewRecord[],
  cardIdForVariant: (variantId: string) => string | undefined,
): Map<string, ProductRatingSummary> {
  const byCard = new Map<string, ProductReviewRecord[]>();

  for (const review of reviews) {
    const cards = new Set<string>();
    for (const productId of review.productIds) {
      const cardId = cardIdForVariant(productId);
      if (cardId) cards.add(cardId);
    }
    for (const cardId of cards) {
      const bucket = byCard.get(cardId);
      if (bucket) bucket.push(review);
      else byCard.set(cardId, [review]);
    }
  }

  const summaries = new Map<string, ProductRatingSummary>();
  for (const product of products) {
    const collected = byCard.get(product.id);
    if (!collected || collected.length === 0) continue;

    const total = collected.reduce((sum, review) => sum + review.rating, 0);
    summaries.set(product.id, {
      // One decimal place: "4.7" is a rating, "4.666666666666667" is a bug
      // report. Rounded here rather than in the browser so the number the page
      // shows and the number the structured data publishes are the same one.
      average: Math.round((total / collected.length) * 10) / 10,
      count: collected.length,
      reviews: collected
        .filter((review) => review.comment !== "")
        .slice(0, QUOTED_REVIEWS_PER_PRODUCT)
        .map(({ productIds: _productIds, ...review }) => review),
    });
  }

  return summaries;
}
