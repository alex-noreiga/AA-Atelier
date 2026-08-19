// Notion schema mapping for the READ side of the "Reviews" database — the
// curated testimonials the site shows on the home and about pages.
//
// The write side (`reviews.blocks.ts`) owns the property-name constants; this
// module imports them rather than restating them, so a Notion rename stays a
// one-line change in one file and the two sides can't drift.
//
// Only the narrow public projection is mapped here. A review row also carries
// the author's email, order number, and `Email Verified` flag; none of those
// leave the server (see `PublishedReview` in the contract).

import {
  REVIEW_RATING_PROPERTY,
  REVIEW_COMMENT_PROPERTY,
  REVIEW_CUSTOMER_NAME_PROPERTY,
  REVIEW_STATUS_PROPERTY,
  REVIEW_CONSENT_PROPERTY,
} from "./reviews.blocks.js";

/**
 * The `Status` select value that makes a review public. A targeted business
 * rule naming one live Notion option value — the same deliberate exception as
 * `STATUS_IN_STOCK` and `SIZE_GUIDE_TYPE_SOAKER`: rename this option in Notion
 * and it must change here too, or every testimonial silently disappears from
 * the site. Everything else (including the default "New") stays unpublished,
 * so the failure direction is "shows nothing", never "publishes something the
 * atelier hadn't curated".
 */
export const REVIEW_STATUS_PUBLISHED = "Published";

/** One curated review, mapped to exactly what the site renders. */
export interface PublishedReviewRecord {
  /** Notion page id — a render key only; never used to look anything up. */
  id: string;
  /** Star rating, 1–5. */
  rating: number;
  /** The testimonial text. */
  comment: string;
  /** How the customer asked to be credited; absent when they left it blank. */
  customerName?: string;
  /** The page's Notion `created_time`, ISO-8601. Absent when Notion didn't
   * return one — the contract makes it optional, and an empty string would
   * fail the response's date-time parse. */
  publishedAt?: string;
}

// --- Raw Notion payload typing (only the property types we read) ---

type NotionPropertyValue =
  | { type: "number"; number: number | null }
  | { type: "rich_text"; rich_text: Array<{ plain_text: string }> }
  | { type: "select"; select: { name: string } | null }
  | { type: "checkbox"; checkbox: boolean };

export interface NotionReviewPage {
  id: string;
  created_time?: string;
  properties: Record<string, NotionPropertyValue | undefined>;
}

export interface NotionReviewsQueryResponse {
  results: NotionReviewPage[];
  has_more: boolean;
  next_cursor: string | null;
}

// --- Extractors (narrow by the runtime `type` discriminator) ---

function extractNumber(page: NotionReviewPage, name: string): number | null {
  const p = page.properties[name];
  if (p?.type !== "number") return null;
  return p.number;
}

function extractRichText(page: NotionReviewPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "rich_text") return "";
  return p.rich_text
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

function extractSelect(page: NotionReviewPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "select") return "";
  return p.select?.name ?? "";
}

function extractCheckbox(page: NotionReviewPage, name: string): boolean {
  const p = page.properties[name];
  if (p?.type !== "checkbox") return false;
  return p.checkbox;
}

/**
 * Whether a review row may be shown publicly. BOTH gates must pass: the
 * atelier curated it (`Status` = the published option) and the customer
 * consented to publication. Curation alone is not enough — consent is the
 * customer's, and the atelier moving a row along its triage flow can't stand in
 * for it. Fails closed: an unset select or an unchecked box means "not public".
 */
export function isPublishable(page: NotionReviewPage): boolean {
  return (
    extractSelect(page, REVIEW_STATUS_PROPERTY) === REVIEW_STATUS_PUBLISHED &&
    extractCheckbox(page, REVIEW_CONSENT_PROPERTY)
  );
}

/**
 * Map the publishable rows of a Notion query page to their public projection,
 * dropping any row that fails {@link isPublishable} or carries no testimonial
 * text (an empty quote renders as a blank card). A missing/out-of-range rating
 * is clamped into the contract's 1–5, so one malformed row can't fail the whole
 * response's zod parse.
 */
export function extractPublishedReviews(
  pages: NotionReviewPage[],
): PublishedReviewRecord[] {
  const records: PublishedReviewRecord[] = [];

  for (const page of pages) {
    if (!isPublishable(page)) continue;

    const comment = extractRichText(page, REVIEW_COMMENT_PROPERTY);
    if (!comment) continue;

    const customerName = extractRichText(page, REVIEW_CUSTOMER_NAME_PROPERTY);
    const rating = extractNumber(page, REVIEW_RATING_PROPERTY);

    records.push({
      id: page.id,
      rating: Math.max(1, Math.min(5, Math.round(rating ?? 5))),
      comment,
      ...(customerName ? { customerName } : {}),
      ...(page.created_time ? { publishedAt: page.created_time } : {}),
    });
  }

  return records;
}
