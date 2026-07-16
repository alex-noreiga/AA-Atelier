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

// A targeted business rule naming one live Stage option — the first stage at
// which the garment is being physically made and measurements are frozen. This
// names a value, not the stage list (which stays live-read from Notion), so it
// is the same kind of deliberate exception as `STATUS_IN_STOCK`: if the atelier
// renames this stage in Notion, update it here (or set the env override).
const DEFAULT_LOCK_FROM_STAGE = "Cutting/Pinning";

function lockFromStage(): string {
  return (
    process.env.MEASUREMENT_LOCK_FROM_STAGE?.trim() || DEFAULT_LOCK_FROM_STAGE
  );
}

/** True when the order's current stage is at or past the production lock point.
 * If either stage is absent from the live list (a renamed/removed option) we
 * fail open and allow the request — a human vets it, and this matches the
 * codebase's graceful-degradation philosophy for live-read stage data. */
function measurementsLocked(currentStage: string, stages: string[]): boolean {
  const thresholdIndex = stages.indexOf(lockFromStage());
  const currentIndex = stages.indexOf(currentStage);
  if (thresholdIndex === -1 || currentIndex === -1) {
    return false;
  }
  return currentIndex >= thresholdIndex;
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

  const trimmedOrderNumber = orderNumber.trim();
  await createMeasurementChangeRequest({
    orderNumber: trimmedOrderNumber,
    emailVerified,
    request: input,
  });

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
