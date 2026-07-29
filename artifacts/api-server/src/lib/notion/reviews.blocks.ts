// Builds the Notion page for a post-delivery review: the page `properties`
// (rating, testimonial, order number, publish consent, curation status) and the
// `children` blocks (the testimonial text + any photos of the finished piece,
// attached as image blocks by their Notion file_upload id — the same mechanism
// the order form uses for reference images).
//
// Unlike the contact-inbox writers, reviews live in their OWN "Reviews"
// database, so this owns its property-name constants. As everywhere in the
// Notion adapter, the property *types* here must match the live schema, not the
// property name (see `.agents/memory/` and the orders schema for that lesson).

import type { z } from "zod";
import type { CreateOrderReviewBody } from "@workspace/api-zod";
import { normalizeEmail } from "../email.js";

// Live-schema property names (a Notion rename is a one-line change here).
export const REVIEW_TITLE_PROPERTY = "Title"; // title
export const REVIEW_RATING_PROPERTY = "Rating"; // number
export const REVIEW_COMMENT_PROPERTY = "Review"; // rich_text
export const REVIEW_CUSTOMER_NAME_PROPERTY = "Customer Name"; // rich_text
export const REVIEW_ORDER_NUMBER_PROPERTY = "Order Number"; // rich_text
export const REVIEW_EMAIL_PROPERTY = "Email"; // email
export const REVIEW_CONSENT_PROPERTY = "Consent to Publish"; // checkbox
export const REVIEW_VERIFIED_PROPERTY = "Email Verified"; // checkbox
export const REVIEW_STATUS_PROPERTY = "Status"; // select
export const REVIEW_CLIENT_PROPERTY = "Client"; // relation → Client CRM

/** The triage stage a fresh review lands in; the atelier moves it to a
 * "Published" (or similar) value when curating it into the portfolio. */
export const REVIEW_DEFAULT_STATUS = "New";

/** Validated review payload, derived from the OpenAPI contract. */
export type CreateReviewInput = z.infer<typeof CreateOrderReviewBody>;

/** Everything a review row needs: the request plus the order it's for and
 * whether the requester's email matched the one stored on the order. */
export interface ReviewRow {
  orderNumber: string;
  emailVerified: boolean;
  request: CreateReviewInput;
}

/** A filled/empty star string, e.g. 4 → "★★★★☆". Bounded to the 1–5 the
 * contract enforces, but clamps defensively so a stray value can't produce a
 * negative repeat count. */
function stars(rating: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

/** An image block backed by an already-uploaded Notion `file_upload` id (see
 * `file-uploads.repository.ts`), rendered inline on the review page. */
function imageBlock(fileUploadId: string) {
  return {
    object: "block",
    type: "image",
    image: { type: "file_upload", file_upload: { id: fileUploadId } },
  };
}

/**
 * Notion page `properties` for a new review. When `clientPageId` is given (the
 * review flow upserted a Client CRM record for this customer), the review is
 * linked to it through the `Client` relation.
 */
export function buildReviewProperties(
  row: ReviewRow,
  clientPageId?: string,
): Record<string, unknown> {
  const { orderNumber, emailVerified, request } = row;
  const credited = request.displayName?.trim();

  const properties: Record<string, unknown> = {
    [REVIEW_TITLE_PROPERTY]: {
      title: [
        {
          text: {
            content: `${stars(request.rating)} — ${credited || "Anonymous"} (order ${orderNumber})`,
          },
        },
      ],
    },
    [REVIEW_RATING_PROPERTY]: {
      number: request.rating,
    },
    [REVIEW_COMMENT_PROPERTY]: {
      rich_text: [{ text: { content: request.comment } }],
    },
    [REVIEW_ORDER_NUMBER_PROPERTY]: {
      rich_text: [{ text: { content: orderNumber } }],
    },
    [REVIEW_EMAIL_PROPERTY]: {
      email: normalizeEmail(request.email),
    },
    [REVIEW_CONSENT_PROPERTY]: {
      checkbox: request.consentToPublish ?? false,
    },
    [REVIEW_VERIFIED_PROPERTY]: {
      checkbox: emailVerified,
    },
    [REVIEW_STATUS_PROPERTY]: {
      select: { name: REVIEW_DEFAULT_STATUS },
    },
  };

  if (credited) {
    properties[REVIEW_CUSTOMER_NAME_PROPERTY] = {
      rich_text: [{ text: { content: credited } }],
    };
  }
  if (clientPageId) {
    properties[REVIEW_CLIENT_PROPERTY] = {
      relation: [{ id: clientPageId }],
    };
  }

  return properties;
}

/** Notion page body (`children`) for a review: the testimonial as a quote, then
 * the customer's photos of the finished piece as inline image blocks. */
export function buildReviewPageBlocks(row: ReviewRow): unknown[] {
  const { request } = row;
  const blocks: unknown[] = [
    {
      object: "block",
      type: "quote",
      quote: {
        rich_text: [{ type: "text", text: { content: request.comment } }],
      },
    },
  ];

  if (request.photoIds && request.photoIds.length > 0) {
    blocks.push(...request.photoIds.map(imageBlock));
  }

  return blocks;
}
