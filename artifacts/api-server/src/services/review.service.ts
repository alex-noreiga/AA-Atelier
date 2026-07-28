// Post-delivery review use-case, independent of HTTP. The route handler calls
// this with already-validated input and turns the result (or thrown domain
// errors) into a response.
//
// Two gates run before the review is filed:
//   1. Delivery — a review is only invited once the order has reached its final
//      (delivered) stage, when the customer has the finished piece in hand.
//      Reviewing an in-progress order is rejected (409).
//   2. Identity — the supplied email must match the one on the order. Orders
//      created before the Email property existed have none stored; rather than
//      lock those customers out, the review is accepted but flagged "unverified"
//      for the atelier to confirm before featuring it (same convention as the
//      measurement-change flow).
//
// The review lands in the dedicated "Reviews" Notion database with a default
// "New" status; the atelier curates which reviews become public testimonials /
// portfolio entries. On success it also sends best-effort emails (customer
// thank-you + atelier notification), the same convention every other submission
// flow follows; the Notion row stays the source of truth, so a mail failure
// never fails the request.

import { findOrderVerification } from "../lib/notion/orders.repository.js";
import { createReview } from "../lib/notion/reviews.repository.js";
import type { CreateReviewInput } from "../lib/notion/reviews.blocks.js";
import { upsertClientByEmail } from "../lib/notion/clients.repository.js";
import { orderDelivered } from "./delivery.js";
import { logger } from "../lib/logger.js";
import { NotFoundError, ForbiddenError, ConflictError } from "../lib/errors.js";
import {
  reviewConfirmationEmail,
  reviewNotificationEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";

export async function submitOrderReview(
  orderNumber: string,
  input: CreateReviewInput,
): Promise<{ received: true }> {
  const order = await findOrderVerification(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }

  // Delivery gate. A review is a post-delivery moment, so it's only accepted
  // once the order has reached its final stage.
  if (!orderDelivered(order.currentStage, order.stages)) {
    throw new ConflictError(
      "You can leave a review once your order has been delivered.",
    );
  }

  // Identity gate. Compare case-insensitively/trimmed. No stored email (legacy
  // order) -> accept but flag unverified; a present-but-different email -> 403.
  const storedEmail = order.email.trim().toLowerCase();
  const suppliedEmail = input.email.trim().toLowerCase();
  let emailVerified: boolean;
  if (!storedEmail) {
    emailVerified = false;
  } else if (storedEmail === suppliedEmail) {
    emailVerified = true;
  } else {
    throw new ForbiddenError("That email doesn't match the one on this order.");
  }

  // Best-effort: link the review to the customer's Client CRM record (dedupe by
  // email). This customer received a delivered order, so a new CRM row would be
  // "Active"; the upsert almost always finds the existing client the order flow
  // created. Never fails the request; no-ops when CRM is unconfigured.
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
  await createReview(
    {
      orderNumber: trimmedOrderNumber,
      emailVerified,
      request: input,
    },
    undefined,
    clientPageId,
  );

  // Best-effort emails; a mail failure must not fail the request. A review is
  // order-related, so it uses the "orders" sender/inbox.
  const from = fromAddress("orders");
  await sendEmailBestEffort({
    ...reviewConfirmationEmail(input, trimmedOrderNumber),
    from,
  });
  const inbox = atelierInbox("orders");
  if (inbox) {
    await sendEmailBestEffort({
      ...reviewNotificationEmail(input, trimmedOrderNumber, inbox),
      from,
    });
  }

  return { received: true };
}
