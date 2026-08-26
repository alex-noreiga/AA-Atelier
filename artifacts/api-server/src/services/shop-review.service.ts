// Review of a ready-to-wear piece, independent of HTTP. The shop-order sibling
// of `review.service.ts`'s `submitOrderReview`, and deliberately built out of
// the same parts: the same identity gate, the same positional delivery rule, the
// same Notion database, the same "New" status, and so the same moderation queue.
// A shop review is not a second kind of review — it is the same review, about a
// piece the studio sells rather than one it made to measure.
//
// One gate is its own: the review must name a piece, and that piece must be on
// the order. A shop order can hold several pieces, and an average belongs to a
// piece rather than to an order, so "which one?" is a question the custom-order
// flow never has to ask. Checking the answer against the order's own
// `Inventory Items` is what stops an order number being used to rate a piece
// nobody bought.

import type { z } from "zod";
import type { CreateShopOrderReviewBody } from "@workspace/api-zod";
import {
  findShopOrderVerification,
  fetchLiveShopOrderStatuses,
} from "../lib/notion/shop-orders.repository.js";
import { createReview } from "../lib/notion/reviews.repository.js";
import type { CreateReviewInput } from "../lib/notion/reviews.blocks.js";
import { upsertClientByEmail } from "../lib/notion/clients.repository.js";
import { findVariantNames } from "./products.service.js";
import { orderDelivered } from "./delivery.js";
import { resolveEmailVerification } from "./order-identity.js";
import { logger } from "../lib/logger.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../lib/errors.js";
import {
  reviewConfirmationEmail,
  reviewNotificationEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";

/** Validated shop-review payload, derived from the OpenAPI contract. */
export type CreateShopReviewInput = z.infer<typeof CreateShopOrderReviewBody>;

export async function submitShopOrderReview(
  orderNumber: string,
  input: CreateShopReviewInput,
): Promise<{ received: true }> {
  const [order, statuses] = await Promise.all([
    findShopOrderVerification(orderNumber),
    fetchLiveShopOrderStatuses(),
  ]);

  if (!order) {
    throw new NotFoundError("We couldn't find a shop order with that number.");
  }

  // A cancelled order was never received, so there is nothing to review. Checked
  // before delivery, because a cancelled order can also sit at a final status
  // and "it hasn't arrived yet" would then be the wrong thing to say.
  if (order.cancelled) {
    throw new ConflictError(
      "This order was cancelled, so it can't be reviewed.",
    );
  }

  // Delivery gate, the same positional rule the custom-order review uses: the
  // order's current status is the last one in the live list. No status name is
  // baked in, so it survives the atelier renaming its workflow — and it fails
  // closed on an unknown status, since a review is a one-way action better
  // withheld than granted on a stale read.
  if (!orderDelivered(order.status, statuses)) {
    throw new ConflictError(
      "You can leave a review once your order has been delivered.",
    );
  }

  // Identity gate (403 on a mismatch; legacy no-email orders accepted unverified).
  const emailVerified = resolveEmailVerification(order.email, input.email);

  // The piece gate. An order that carries no linked pieces at all (placed before
  // the `Inventory Items` relation was written) is told so plainly rather than
  // being refused as though the customer named the wrong thing — there is
  // nothing they could have typed that would work.
  const productId = input.productId.trim();
  if (order.itemIds.length === 0) {
    throw new BadRequestError(
      "We can't tell which pieces are on this order, so it can't be reviewed here. Reply to your order email and we'll pass your words on.",
    );
  }
  if (!order.itemIds.includes(productId)) {
    throw new BadRequestError("That piece isn't on this order.");
  }

  // Best-effort label for the piece, from live inventory. Absent for a piece the
  // atelier has since unpublished — the relation is what the rating is built
  // from, so the review is filed either way.
  const productName =
    (await findVariantNames([productId])).get(productId) ?? "";

  // Best-effort: link the review to the customer's Client CRM record (dedupe by
  // email). This customer bought and received a piece, so a new CRM row would be
  // "Active"; the upsert almost always finds the one checkout created. Never
  // fails the request; no-ops when the CRM is unconfigured.
  let clientPageId: string | undefined;
  try {
    clientPageId =
      (await upsertClientByEmail({
        fullName: input.displayName?.trim() ?? "",
        email: input.email,
      })) ?? undefined;
  } catch (err) {
    logger.warn(
      { err },
      "Failed to upsert Client CRM record; filing the review without a client link",
    );
  }

  const trimmedOrderNumber = orderNumber.trim();
  // The row shape is the custom-order review's, plus the piece. `productId` is
  // not part of it: the relation carries the piece, and a second copy of the
  // same fact is one more thing that can disagree with itself.
  const { productId: _productId, ...review } = input;
  await createReview(
    {
      orderNumber: trimmedOrderNumber,
      emailVerified,
      request: review satisfies CreateReviewInput,
      product: { pageId: productId, name: productName },
    },
    undefined,
    clientPageId,
  );

  // Best-effort emails; a mail failure must not fail the request. A review is
  // order-related, so it uses the "orders" sender/inbox.
  const from = fromAddress("orders");
  await sendEmailBestEffort({
    ...reviewConfirmationEmail(review, trimmedOrderNumber, productName),
    from,
  });
  const inbox = atelierInbox("orders");
  if (inbox) {
    await sendEmailBestEffort({
      ...reviewNotificationEmail(
        review,
        trimmedOrderNumber,
        inbox,
        productName,
      ),
      from,
    });
  }

  return { received: true };
}
