// Builds the Notion page `properties` for a new customer review. Property
// *types* here must match the live "Website Reviews" schema, not the property
// name (see `.agents/memory/` and schema.ts for the same lesson on the orders
// database). Kept separate from the HTTP/Notion request layer so the
// domain-field -> Notion-property mapping is independently testable.
//
// A new review is always written UNPUBLISHED: it only appears on the site once
// the atelier ticks "Published" in Notion (the same moderation gate the shop's
// "Show on website" checkbox provides). `Verified` records whether the
// submitter's email matched the order, so the atelier can prioritise moderation.

import type { z } from "zod";
import type { CreateReviewBody } from "@workspace/api-zod";
import {
  REVIEW_NAME_PROPERTY,
  REVIEW_RATING_PROPERTY,
  REVIEW_BODY_PROPERTY,
  REVIEW_TITLE_PROPERTY,
  REVIEW_EMAIL_PROPERTY,
  REVIEW_ORDER_PROPERTY,
  REVIEW_VERIFIED_PROPERTY,
  REVIEW_PUBLISH_PROPERTY,
} from "./reviews.schema.js";

/** Validated review payload, derived from the OpenAPI contract. */
export type CreateReviewInput = z.infer<typeof CreateReviewBody>;

/** A review plus whether we could verify the submitter's email against the order. */
export interface ReviewRow {
  verified: boolean;
  review: CreateReviewInput;
}

/** Notion page `properties` for a new review. */
export function buildReviewProperties(row: ReviewRow): Record<string, unknown> {
  const { verified, review } = row;

  const properties: Record<string, unknown> = {
    [REVIEW_NAME_PROPERTY]: {
      title: [{ text: { content: review.name } }],
    },
    [REVIEW_RATING_PROPERTY]: {
      number: review.rating,
    },
    [REVIEW_BODY_PROPERTY]: {
      rich_text: [{ text: { content: review.body } }],
    },
    [REVIEW_EMAIL_PROPERTY]: {
      email: review.email,
    },
    [REVIEW_ORDER_PROPERTY]: {
      rich_text: [{ text: { content: review.orderNumber } }],
    },
    [REVIEW_VERIFIED_PROPERTY]: {
      checkbox: verified,
    },
    // Moderation gate — a new review is never published automatically.
    [REVIEW_PUBLISH_PROPERTY]: {
      checkbox: false,
    },
  };

  if (review.title) {
    properties[REVIEW_TITLE_PROPERTY] = {
      rich_text: [{ text: { content: review.title } }],
    };
  }

  return properties;
}
