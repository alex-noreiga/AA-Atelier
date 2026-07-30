// Return / exchange request use-case, independent of HTTP. The route handler
// calls this with already-validated input and turns the result (or thrown
// domain errors) into a response.
//
// Two gates run before the request is filed (Approach A — the atelier reviews
// and actions the request; this never refunds or edits the order):
//   1. Existence — the shop order number must resolve to a real order (404).
//   2. Identity — the supplied email must match the one on the order. Orders
//      placed before the Email property existed have none stored; rather than
//      lock those customers out, the request is accepted but flagged
//      "unverified" for the atelier to confirm.
//
// There is deliberately no time-window gate: whether a request falls inside the
// 30-day policy is an atelier judgement call, not something to reject at intake.
//
// On success it also sends best-effort emails (customer confirmation + atelier
// notification), the same convention every other submission flow follows; the
// Notion row stays the source of truth, so a mail failure never fails the request.

import { findShopOrderVerification } from "../lib/notion/shop-orders.repository.js";
import { createReturnRequest } from "../lib/notion/return-request.repository.js";
import type { CreateReturnInput } from "../lib/notion/return-request.blocks.js";
import { upsertClientByEmail } from "../lib/notion/clients.repository.js";
import { logger } from "../lib/logger.js";
import { NotFoundError, ForbiddenError } from "../lib/errors.js";
import {
  returnRequestConfirmationEmail,
  returnRequestNotificationEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";

export async function submitReturnRequest(
  orderNumber: string,
  input: CreateReturnInput,
): Promise<{ received: true }> {
  const order = await findShopOrderVerification(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find a shop order with that number.");
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

  // Best-effort: link the request to the customer's Client CRM record (dedupe by
  // email). This customer placed the order, so a new CRM row defaults to
  // "Active"; the upsert almost always finds the existing client the checkout
  // flow created. Never fails the request; no-ops when CRM is unconfigured.
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
      "Failed to upsert Client CRM record; filing the return request without a client link",
    );
  }

  const trimmedOrderNumber = orderNumber.trim();
  await createReturnRequest(
    {
      orderNumber: trimmedOrderNumber,
      emailVerified,
      request: input,
    },
    undefined,
    clientPageId,
  );

  // Best-effort emails; a mail failure must not fail the request. A return is
  // order-related, so it uses the "orders" sender/inbox.
  const from = fromAddress("orders");
  await sendEmailBestEffort({
    ...returnRequestConfirmationEmail(input, trimmedOrderNumber),
    from,
  });
  const inbox = atelierInbox("orders");
  if (inbox) {
    await sendEmailBestEffort({
      ...returnRequestNotificationEmail(input, trimmedOrderNumber, inbox),
      from,
    });
  }

  return { received: true };
}
