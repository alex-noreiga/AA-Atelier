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

import { findOrderForMeasurementChange } from "../lib/notion/orders.repository.js";
import { createMeasurementChangeRequest } from "../lib/notion/measurement-change.repository.js";
import type { CreateMeasurementChangeInput } from "../lib/notion/measurement-change.blocks.js";
import { upsertClientByEmail } from "../lib/notion/clients.repository.js";
import { measurementsLocked } from "./measurement-lock.js";
import { logger } from "../lib/logger.js";
import {
  NotFoundError,
  ForbiddenError,
  MeasurementsLockedError,
  ValidationError,
} from "../lib/errors.js";
import {
  measurementChangeConfirmationEmail,
  measurementChangeNotificationEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";

const MEASUREMENT_FIELDS = [
  "waist",
  "bust",
  "hips",
  "height",
  "bodyGirth",
] as const;

/** True when every body measurement is present as a number. */
function hasAllMeasurements(input: CreateMeasurementChangeInput): boolean {
  return MEASUREMENT_FIELDS.every((field) => typeof input[field] === "number");
}

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

  const order = await findOrderForMeasurementChange(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
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

  if (measurementsLocked(order.currentStage, order.stages)) {
    throw new MeasurementsLockedError(
      "Measurements can no longer be changed once your dress is in production. Please contact us.",
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
