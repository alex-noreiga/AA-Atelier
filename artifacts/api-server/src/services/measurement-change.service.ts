// Measurement-change request use-case, independent of HTTP. The route handler
// calls this with already-validated input and turns the result (or thrown
// domain errors) into a response.
//
// Three gates run before the request is filed (Approach A — the atelier applies
// the change; this never edits the order):
//   1. Values-or-appointment — the flat schema can't express it: the customer
//      must either supply all five measurements or ask to be re-measured at an
//      appointment. Reject a request with neither (400).
//   2. Identity — the supplied email must match the one on the order. Orders
//      created before the Email property existed have none stored; rather than
//      lock those customers out, the request is accepted but flagged
//      "unverified" for the atelier to confirm.
//   3. Production lock — once the garment reaches the production stage, the
//      measurements can no longer be changed.
//
// On success it also sends best-effort emails (customer confirmation + atelier
// notification), the same convention every other submission flow follows; the
// Notion row stays the source of truth, so a mail failure never fails the request.

import { findOrderVerification } from "../lib/notion/orders.repository.js";
import { createMeasurementChangeRequest } from "../lib/notion/measurement-change.repository.js";
import type { CreateMeasurementChangeInput } from "../lib/notion/measurement-change.blocks.js";
import { upsertClientByEmail } from "../lib/notion/clients.repository.js";
import { measurementsLocked } from "./measurement-lock.js";
import { relationLinksEnabled } from "./request-links.js";
import { resolveEmailVerification } from "./order-identity.js";
import { hasAllMeasurements } from "./measurements.js";
import { logger } from "../lib/logger.js";
import {
  NotFoundError,
  MeasurementsLockedError,
  ValidationError,
} from "../lib/errors.js";
import {
  measurementChangeConfirmationEmail,
  measurementChangeNotificationEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";

export async function submitMeasurementChangeRequest(
  orderNumber: string,
  input: CreateMeasurementChangeInput,
): Promise<{ received: true }> {
  // Values-or-appointment rule (pure input, so checked before any lookup).
  if (!input.measurementAppointment && !hasAllMeasurements(input)) {
    throw new ValidationError(
      "Please enter your measurements or request a measurement appointment.",
    );
  }

  const order = await findOrderVerification(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }

  // Identity gate (403 on a mismatch; legacy no-email orders accepted unverified).
  const emailVerified = resolveEmailVerification(order.email, input.email);

  if (measurementsLocked(order.currentStage, order.stages)) {
    throw new MeasurementsLockedError(
      "Measurements can no longer be changed once your costume is in production. Please contact us.",
    );
  }

  // Best-effort: link the request to the customer's Client CRM record (dedupe by
  // email). This customer placed the order, so a new CRM row is "Active"; the
  // upsert almost always finds the existing client the order flow created. Never
  // fails the request; no-ops when CRM is unconfigured.
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
      "Failed to upsert Client CRM record; filing the measurement-change request without a client link",
    );
  }

  const trimmedOrderNumber = orderNumber.trim();
  await createMeasurementChangeRequest(
    {
      orderNumber: trimmedOrderNumber,
      emailVerified,
      request: input,
      ...(relationLinksEnabled() ? { orderPageId: order.pageId } : {}),
    },
    undefined,
    clientPageId,
  );

  // Best-effort emails; a mail failure must not fail the request. A measurement
  // change is order-related, so it uses the "orders" sender/inbox.
  const from = fromAddress("orders");
  await sendEmailBestEffort({
    ...measurementChangeConfirmationEmail(input, trimmedOrderNumber),
    from,
  });
  const inbox = atelierInbox("orders");
  if (inbox) {
    await sendEmailBestEffort({
      ...measurementChangeNotificationEmail(input, trimmedOrderNumber, inbox),
      from,
    });
  }

  return { received: true };
}
