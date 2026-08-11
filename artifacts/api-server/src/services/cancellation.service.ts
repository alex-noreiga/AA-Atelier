// Order-cancellation REQUEST use-cases, independent of HTTP. The route handlers
// call these with already-validated input and turn the result (or thrown domain
// errors) into a response.
//
// This is the customer-facing half of order cancellation (Approach A, like the
// measurement-change flow): it files a request into the atelier's Notion inbox
// and never refunds or edits the order. The atelier reviews the request and then
// processes the refund with the cancellation button (order-cancellation.service).
//
// Two gates run before a request is filed:
//   1. Identity — the supplied email must match the one on the order. Orders with
//      no stored email (legacy) are accepted but flagged "unverified" for the
//      atelier to confirm before refunding, exactly as measurement-change does.
//   2. (Custom only) Delivery — a delivered order is a return, not a cancellation,
//      so a delivered custom order is rejected (409) and pointed to returns. Shop
//      orders have no delivery gate; the atelier decides refundability at the button.
//
// On success it also sends best-effort emails (customer confirmation + atelier
// notification), the same convention every other submission flow follows; the
// Notion row stays the source of truth, so a mail failure never fails the request.

import type { z } from "zod";
import type { CreateOrderCancellationRequestBody } from "@workspace/api-zod";
import { findOrderVerification } from "../lib/notion/orders.repository.js";
import { findShopOrderForCancellation } from "../lib/notion/shop-orders.repository.js";
import { createCancellationRequest } from "../lib/notion/cancellation.repository.js";
import type { CancellationOrderType } from "../lib/notion/cancellation.blocks.js";
import { upsertClientByEmail } from "../lib/notion/clients.repository.js";
import { orderDelivered } from "./delivery.js";
import { relationLinksEnabled } from "./request-links.js";
import { resolveEmailVerification } from "./order-identity.js";
import { logger } from "../lib/logger.js";
import { NotFoundError, ConflictError } from "../lib/errors.js";
import {
  cancellationRequestConfirmationEmail,
  cancellationRequestNotificationEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";

/** Validated cancellation payload, derived from the OpenAPI contract. The custom
 * and shop request bodies share the same `NewCancellationRequest` shape. */
export type CreateCancellationInput = z.infer<
  typeof CreateOrderCancellationRequestBody
>;

/** File the request into Notion (best-effort CRM link) + send best-effort emails.
 * Shared by the custom and shop flows once the order-specific gates have passed. */
async function fileCancellationRequest(
  orderNumber: string,
  orderType: CancellationOrderType,
  input: CreateCancellationInput,
  emailVerified: boolean,
  orderPageId: string,
): Promise<{ received: true }> {
  // Best-effort: link the request to the customer's Client CRM record (dedupe by
  // email). Never fails the request; no-ops when CRM is unconfigured.
  let clientPageId: string | undefined;
  try {
    clientPageId =
      (await upsertClientByEmail({
        fullName: "",
        email: input.email,
      })) ?? undefined;
  } catch (err) {
    logger.warn(
      { err },
      "Failed to upsert Client CRM record; filing the cancellation request without a client link",
    );
  }

  const trimmedOrderNumber = orderNumber.trim();
  await createCancellationRequest(
    {
      orderNumber: trimmedOrderNumber,
      orderType,
      emailVerified,
      email: input.email,
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
      ...(relationLinksEnabled() ? { orderPageId } : {}),
    },
    undefined,
    clientPageId,
  );

  // Best-effort emails; a mail failure must not fail the request. A cancellation
  // is order-related, so it uses the "orders" sender/inbox.
  const from = fromAddress("orders");
  await sendEmailBestEffort({
    ...cancellationRequestConfirmationEmail(input.email, trimmedOrderNumber),
    from,
  });
  const inbox = atelierInbox("orders");
  if (inbox) {
    await sendEmailBestEffort({
      ...cancellationRequestNotificationEmail(
        {
          orderNumber: trimmedOrderNumber,
          orderType,
          email: input.email,
          emailVerified,
          ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
        },
        inbox,
      ),
      from,
    });
  }

  return { received: true };
}

/** File a cancellation request for a custom (bespoke) order. */
export async function submitOrderCancellationRequest(
  orderNumber: string,
  input: CreateCancellationInput,
): Promise<{ received: true }> {
  const order = await findOrderVerification(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }

  // Delivery gate — a delivered order is a return, not a cancellation.
  if (orderDelivered(order.currentStage, order.stages)) {
    throw new ConflictError(
      "This order has already been delivered, so it can't be cancelled. Please contact us about a return.",
    );
  }

  const emailVerified = resolveEmailVerification(order.email, input.email);
  return fileCancellationRequest(
    orderNumber,
    "custom",
    input,
    emailVerified,
    order.pageId,
  );
}

/** File a cancellation request for a ready-to-wear shop order. */
export async function submitShopOrderCancellationRequest(
  orderNumber: string,
  input: CreateCancellationInput,
): Promise<{ received: true }> {
  const order = await findShopOrderForCancellation(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find a shop order with that number.");
  }

  const emailVerified = resolveEmailVerification(order.email, input.email);
  return fileCancellationRequest(
    orderNumber,
    "shop",
    input,
    emailVerified,
    order.pageId,
  );
}
