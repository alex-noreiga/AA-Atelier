// Notion schema mapping for the READ side of the "Reviews" database — the
// curated testimonials the site shows on the home and about pages.
//
// The write side (`reviews.blocks.ts`) owns the property-name constants; this
// module imports them rather than restating them, so a Notion rename stays a
// one-line change in one file and the two sides can't drift.
//
// Two projections live here, and the difference between them is the whole
// point. `extractPublishedReviews` is the narrow PUBLIC one — a review row also
// carries the author's email, order number, and `Email Verified` flag, and none
// of those leave the server (see `PublishedReview` in the contract).
// `extractStudioReviews` is the STAFF one behind the dashboard's moderation
// queue, which is the same row in full: the atelier is deciding whether to put
// it on the site, and who wrote it and whether their address matched the order
// are part of that judgement.

import {
  REVIEW_RATING_PROPERTY,
  REVIEW_COMMENT_PROPERTY,
  REVIEW_CUSTOMER_NAME_PROPERTY,
  REVIEW_ORDER_NUMBER_PROPERTY,
  REVIEW_EMAIL_PROPERTY,
  REVIEW_VERIFIED_PROPERTY,
  REVIEW_STATUS_PROPERTY,
  REVIEW_CONSENT_PROPERTY,
  REVIEW_DEFAULT_STATUS,
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

/**
 * The `Status` value the dashboard WRITES when the atelier sets a review aside.
 * The same kind of targeted rule as {@link REVIEW_STATUS_PUBLISHED}, and the
 * only other value the app writes — Notion creates the select option on first
 * use, so nothing has to be configured for it to exist.
 */
export const REVIEW_STATUS_REJECTED = "Rejected";

/**
 * The `Status` values READ as "set aside", which is a wider set than the one
 * value written. `Archived` predates the moderation queue — it is how a review
 * was retired from the site before this existed, and the Reviews database still
 * carries the option — so reading it as a decision already taken is what stops
 * the queue opening on a backlog of rows the atelier had already dealt with.
 * A decision made here rewrites the row to {@link REVIEW_STATUS_REJECTED}, so
 * the two converge over time without a migration.
 */
export const REVIEW_SET_ASIDE_STATUSES = [
  REVIEW_STATUS_REJECTED,
  "Archived",
] as const;

/**
 * Where a review stands with the atelier, DERIVED from its `Status` rather than
 * enumerated from it. Only the two values above are recognized; everything else
 * — the "New" a review is captured with, a blank select, or a value the atelier
 * invented — is `pending`.
 *
 * That direction is deliberate. An unrecognized status asks for a decision
 * instead of standing in for one, so the failure mode of a Notion rename is a
 * queue that reappears, never a testimonial published without curation.
 */
export type ReviewModeration = "pending" | "published" | "rejected";

/** The `Status` text written for each moderation state. `pending` writes the
 * capture default, so re-queueing a review leaves the row exactly as a freshly
 * submitted one. */
export const MODERATION_STATUS_VALUES: Record<ReviewModeration, string> = {
  pending: REVIEW_DEFAULT_STATUS,
  published: REVIEW_STATUS_PUBLISHED,
  rejected: REVIEW_STATUS_REJECTED,
};

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
  | { type: "checkbox"; checkbox: boolean }
  | { type: "email"; email: string | null };

export interface NotionReviewPage {
  id: string;
  created_time?: string;
  /** The row's page in Notion. Served to staff only, as an escape hatch to
   * whatever the queue doesn't show. */
  url?: string;
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

// --- Staff projection: the dashboard's moderation queue ---

/** One review as the atelier sees it while deciding what to do with it. The
 * photographs are NOT here: they live in the page body rather than a property,
 * so the repository fetches them separately for the rows that need them. */
export interface StudioReviewRecord {
  id: string;
  rating: number;
  comment: string;
  customerName?: string;
  orderNumber?: string;
  email?: string;
  /** Whether the submitted address matched the one on the order. */
  emailVerified: boolean;
  /** Whether the customer agreed to publication. Publishing without it is
   * refused — the atelier can't consent on a customer's behalf. */
  consentToPublish: boolean;
  status: ReviewModeration;
  /** The `Status` select verbatim, when set. Carried so a row the app reads as
   * pending can say what Notion actually holds — "New", or something the
   * atelier typed — instead of leaving the queue unexplained. */
  rawStatus?: string;
  submittedAt?: string;
  notionUrl?: string;
}

function extractEmail(page: NotionReviewPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "email") return "";
  return p.email?.trim() ?? "";
}

/** Read a row's moderation state off its `Status`. See {@link ReviewModeration}
 * for why anything unrecognized reads as pending. */
export function reviewModeration(page: NotionReviewPage): ReviewModeration {
  const status = extractSelect(page, REVIEW_STATUS_PROPERTY);
  if (status === REVIEW_STATUS_PUBLISHED) return "published";
  if ((REVIEW_SET_ASIDE_STATUSES as readonly string[]).includes(status)) {
    return "rejected";
  }
  return "pending";
}

/**
 * Map one Notion review row to the staff projection.
 *
 * Nothing is dropped here, which is the difference from the public extractor
 * above: a row with no testimonial text or a nonsense rating is exactly the row
 * the atelier needs to see in order to reject it, so it is shown rather than
 * filtered out. The rating is still clamped into the contract's 1–5 so one
 * malformed row can't fail the whole response's parse.
 */
export function extractStudioReview(
  page: NotionReviewPage,
): StudioReviewRecord {
  const customerName = extractRichText(page, REVIEW_CUSTOMER_NAME_PROPERTY);
  const orderNumber = extractRichText(page, REVIEW_ORDER_NUMBER_PROPERTY);
  const email = extractEmail(page, REVIEW_EMAIL_PROPERTY);
  const rawStatus = extractSelect(page, REVIEW_STATUS_PROPERTY);
  const rating = extractNumber(page, REVIEW_RATING_PROPERTY);

  return {
    id: page.id,
    rating: Math.max(1, Math.min(5, Math.round(rating ?? 5))),
    comment: extractRichText(page, REVIEW_COMMENT_PROPERTY),
    emailVerified: extractCheckbox(page, REVIEW_VERIFIED_PROPERTY),
    consentToPublish: extractCheckbox(page, REVIEW_CONSENT_PROPERTY),
    status: reviewModeration(page),
    ...(customerName ? { customerName } : {}),
    ...(orderNumber ? { orderNumber } : {}),
    ...(email ? { email } : {}),
    ...(rawStatus ? { rawStatus } : {}),
    ...(page.created_time ? { submittedAt: page.created_time } : {}),
    ...(page.url ? { notionUrl: page.url } : {}),
  };
}

export function extractStudioReviews(
  pages: NotionReviewPage[],
): StudioReviewRecord[] {
  return pages.map(extractStudioReview);
}

// --- The review's photographs (page body, not properties) ---

/** The block shapes we read out of a review page's body. An `image` block is
 * either a Notion-hosted file (what the upload endpoint produces) or an
 * external URL (what a paste into the page produces); anything else is the
 * testimonial quote and is ignored. */
export interface NotionBlock {
  type?: string;
  image?: {
    file?: { url?: string };
    external?: { url?: string };
  };
}

export interface NotionBlockChildrenResponse {
  results: NotionBlock[];
  has_more: boolean;
  next_cursor: string | null;
}

/**
 * The image URLs on a review page, in body order.
 *
 * A Notion-hosted URL is SIGNED AND SHORT-LIVED (about an hour), which is why
 * these are fetched per page load and never stored: a cached one renders as a
 * broken image, which on a moderation queue reads as "the customer sent no
 * photo" rather than "this link expired".
 */
export function extractImageUrls(blocks: NotionBlock[]): string[] {
  const urls: string[] = [];
  for (const block of blocks) {
    if (block.type !== "image") continue;
    const url = block.image?.file?.url ?? block.image?.external?.url;
    if (url) urls.push(url);
  }
  return urls;
}
