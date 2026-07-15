// Review use-cases, independent of HTTP. The route handlers call these with
// already-validated input and turn the result (or thrown domain errors) into a
// response.
//
// Submitting a review runs the same identity gate as the measurement-change
// flow: the order number must resolve to an order whose stored email matches
// the supplied one. A legacy order with no stored email is accepted but flagged
// unverified (the atelier moderates every review before it shows, so this is a
// spam-reduction gate, not a security boundary). Reviews reuse
// `findOrderForMeasurementChange` for the lookup — the stage fields it also
// returns are simply unused here.

import { findOrderForMeasurementChange } from "../lib/notion/orders.repository.js";
import {
  createReview,
  listPublishedReviews,
} from "../lib/notion/reviews.repository.js";
import type { CreateReviewInput } from "../lib/notion/reviews.blocks.js";
import type { ReviewRecord } from "../lib/notion/reviews.schema.js";
import { NotFoundError, ForbiddenError } from "../lib/errors.js";
import {
  reviewAckEmail,
  reviewNotificationEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";

/** The published reviews shown on the site, newest first. */
export async function listReviews(): Promise<{ reviews: ReviewRecord[] }> {
  const reviews = await listPublishedReviews();
  return { reviews };
}

export async function submitReview(
  input: CreateReviewInput,
): Promise<{ success: true }> {
  const order = await findOrderForMeasurementChange(input.orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }

  // Identity gate. Compare case-insensitively/trimmed. No stored email (legacy
  // order) -> accept but flag unverified; a present-but-different email -> 403.
  const storedEmail = order.email.trim().toLowerCase();
  const suppliedEmail = input.email.trim().toLowerCase();
  let verified: boolean;
  if (!storedEmail) {
    verified = false;
  } else if (storedEmail === suppliedEmail) {
    verified = true;
  } else {
    throw new ForbiddenError("That email doesn't match the one on this order.");
  }

  await createReview({ verified, review: input });

  // Best-effort emails; a mail failure must not fail the submit. A review is
  // order-related, so it uses the "orders" sender/inbox.
  const from = fromAddress("orders");
  await sendEmailBestEffort({ ...reviewAckEmail(input), from });
  const inbox = atelierInbox("orders");
  if (inbox) {
    await sendEmailBestEffort({
      ...reviewNotificationEmail(input, inbox),
      from,
    });
  }

  return { success: true };
}
