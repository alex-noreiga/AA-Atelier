// Review use-cases, independent of HTTP. The route handlers call these with
// already-validated input and turn the result (or thrown domain errors) into a
// response.
//
// Submitting a review is gated on proving a past purchase, and there are two
// channels:
//   - Custom order: the customer supplies an order number, and the same identity
//     gate as the measurement-change flow runs (the order must exist and its
//     stored email must match; a legacy order with no stored email is accepted
//     but flagged unverified). Reviews reuse `findOrderForMeasurementChange` for
//     this lookup — the stage fields it also returns are simply unused here.
//   - Shop purchase: shop orders carry no human order number, so the customer
//     omits it and proves the purchase with the email they checked out with,
//     matched against a paid shop order. No match -> rejected.
// A human moderates every review before it shows (the `Published` gate), so this
// is a spam-reduction gate, not a security boundary.

import { findOrderForMeasurementChange } from "../lib/notion/orders.repository.js";
import { findPaidShopOrderByEmail } from "../lib/notion/shop-orders.repository.js";
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

/** Prove the purchase and resolve the review's verified flag + order reference,
 * routing on whether a custom-order number was supplied. */
async function verifyPurchase(
  input: CreateReviewInput,
): Promise<{ verified: boolean; orderReference: string }> {
  const orderNumber = input.orderNumber?.trim();

  // Custom-order channel: an order number was supplied.
  if (orderNumber) {
    const order = await findOrderForMeasurementChange(orderNumber);
    if (!order) {
      throw new NotFoundError("We couldn't find an order with that number.");
    }

    // Identity gate. Compare case-insensitively/trimmed. No stored email (legacy
    // order) -> accept but flag unverified; a present-but-different email -> 403.
    const storedEmail = order.email.trim().toLowerCase();
    const suppliedEmail = input.email.trim().toLowerCase();
    if (!storedEmail) {
      return { verified: false, orderReference: orderNumber };
    }
    if (storedEmail === suppliedEmail) {
      return { verified: true, orderReference: orderNumber };
    }
    throw new ForbiddenError("That email doesn't match the one on this order.");
  }

  // Shop channel: no order number, so match the email against a paid shop order.
  const shopOrder = await findPaidShopOrderByEmail(input.email);
  if (!shopOrder) {
    throw new ForbiddenError(
      "We couldn't find a shop order for that email. If you have a custom order, enter its order number.",
    );
  }
  return { verified: true, orderReference: shopOrder.sessionId };
}

export async function submitReview(
  input: CreateReviewInput,
): Promise<{ success: true }> {
  const { verified, orderReference } = await verifyPurchase(input);

  await createReview({ verified, orderReference, review: input });

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
