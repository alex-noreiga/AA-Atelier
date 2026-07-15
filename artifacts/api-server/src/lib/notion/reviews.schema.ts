// Notion schema mapping for the "Website Reviews" database that stores customer
// reviews.
//
// Same lessons as `schema.ts` / `products.schema.ts` apply: property *types*
// must match the live Notion schema, not the name (verified against a sample
// page). The property-name literals live here so a Notion rename is a one-line
// change. The write-side property names are re-exported by `reviews.blocks.ts`
// so the reader and writer of this database can't drift apart.

export const REVIEW_NAME_PROPERTY = "Name"; // title — reviewer display name
export const REVIEW_RATING_PROPERTY = "Rating"; // number — 1..5
export const REVIEW_BODY_PROPERTY = "Review"; // rich_text — the review text
export const REVIEW_TITLE_PROPERTY = "Title"; // rich_text — optional headline
export const REVIEW_EMAIL_PROPERTY = "Email"; // email — private, verification record
export const REVIEW_ORDER_PROPERTY = "Order Number"; // rich_text — order it's tied to
export const REVIEW_VERIFIED_PROPERTY = "Verified"; // checkbox — email matched the order
export const REVIEW_PUBLISH_PROPERTY = "Published"; // checkbox — moderation gate

const RATING_MIN = 1;
const RATING_MAX = 5;

/** A published review, mapped to the shape the site cares about. */
export interface ReviewRecord {
  id: string;
  name: string;
  rating: number;
  body: string;
  title?: string;
  /** ISO-8601 timestamp — the Notion page's created time. */
  date: string;
}

// --- Raw Notion payload typing (only the property types we read) ---

type NotionPropertyValue =
  | { type: "title"; title: Array<{ plain_text: string }> }
  | { type: "rich_text"; rich_text: Array<{ plain_text: string }> }
  | { type: "number"; number: number | null }
  | { type: "checkbox"; checkbox: boolean };

export interface NotionReviewPage {
  id: string;
  created_time: string;
  properties: Record<string, NotionPropertyValue | undefined>;
}

export interface NotionReviewsQueryResponse {
  results: NotionReviewPage[];
  has_more: boolean;
  next_cursor: string | null;
}

// --- Extractors (narrow by the runtime `type` discriminator) ---

function extractTitle(page: NotionReviewPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "title") return "";
  return p.title
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

function extractRichText(page: NotionReviewPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "rich_text") return "";
  return p.rich_text
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

function extractNumber(page: NotionReviewPage, name: string): number | null {
  const p = page.properties[name];
  if (p?.type !== "number") return null;
  return p.number;
}

function extractCheckbox(page: NotionReviewPage, name: string): boolean {
  const p = page.properties[name];
  if (p?.type !== "checkbox") return false;
  return p.checkbox;
}

/** Whether a review row's Published checkbox is checked. */
export function extractIsPublished(page: NotionReviewPage): boolean {
  return extractCheckbox(page, REVIEW_PUBLISH_PROPERTY);
}

/** Clamp a raw Notion number into the 1..5 star range the contract promises.
 * A published review always carries a rating; a missing/out-of-range value is
 * defended against rather than trusted (defaults to the top of the range). */
function normalizeRating(raw: number | null): number {
  const value = raw === null ? RATING_MAX : Math.round(raw);
  return Math.max(RATING_MIN, Math.min(RATING_MAX, value));
}

/** Map a raw review page into a domain review record. */
export function extractReview(page: NotionReviewPage): ReviewRecord {
  const title = extractRichText(page, REVIEW_TITLE_PROPERTY);
  return {
    id: page.id,
    name: extractTitle(page, REVIEW_NAME_PROPERTY),
    rating: normalizeRating(extractNumber(page, REVIEW_RATING_PROPERTY)),
    body: extractRichText(page, REVIEW_BODY_PROPERTY),
    ...(title ? { title } : {}),
    date: page.created_time,
  };
}
