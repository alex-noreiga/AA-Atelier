// In-place measurement editing — the customer edits the measurements on their
// own order and the app writes them, instead of filing a request a human
// applies by hand (`measurement-change.service.ts`, which this sits beside
// rather than replaces).
//
// It reuses that flow's gates, and the difference in how they fail is the whole
// design. A change request is read by a person before anything changes, so it
// can afford to degrade: a legacy order with no stored email is accepted and
// flagged "unverified" for the atelier to vet. This endpoint has no such reader
// — what it writes is what the garment is cut to — so it never degrades into
// writing anyway. It DELEGATES instead, which is a different thing: where an
// edit can't be trusted or can't be stored, the same values are filed as an
// ordinary change request and reported as `outcome: "filed"`. Nothing the
// customer typed is lost, and nothing is written that a human didn't vet.
//
//   1. Identity — a supplied email that CONTRADICTS the one on the order is
//      refused outright (403): that is someone else's order, and there is
//      nothing to file. An order carrying no email at all is the unverifiable
//      case, and is filed rather than written.
//   2. Production lock — refused once the garment reaches the lock stage, the
//      same `measurementsLocked` rule the tracking page reads to hide the
//      affordance (409). Filing is deliberately NOT offered here: past the lock
//      the change request is refused too, because the answer is the same one
//      either way — the piece is already being cut, so talk to the atelier.
//      Note that rule itself fails OPEN on an unrecognized stage, which is
//      deliberate and unchanged (a live-read stage list the atelier renamed
//      shouldn't freeze every order in the studio); the identity gate is what
//      stands between a stranger and the write.
//   3. Somewhere to store it — a database without the measurement properties
//      would otherwise report a save that stored nothing, so it files too.
//
// Both emails are best-effort, as everywhere else, but they carry more weight
// here than a confirmation usually does: they are the tripwire. The customer's
// copy shows what each value was and what it now is, so an edit they didn't
// make is visible to the one person certain to notice; the atelier's copy is
// what stops a change to an order already in the workroom going unread.

import {
  findOrderVerification,
  updateOrderMeasurements,
} from "../lib/notion/orders.repository.js";
import type { MeasurementValues } from "../lib/notion/orders.blocks.js";
import type { OrderMeasurements } from "../lib/notion/orders.schema.js";
import { measurementsLocked } from "./measurement-lock.js";
import { logger } from "../lib/logger.js";
import {
  NotFoundError,
  ForbiddenError,
  MeasurementsLockedError,
  MeasurementPropertiesMissingError,
} from "../lib/errors.js";
import { submitMeasurementChangeRequest } from "./measurement-change.service.js";
import {
  measurementsUpdatedEmail,
  measurementsUpdatedNotificationEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";

/** The validated request body, as the contract defines it. */
export interface UpdateMeasurementsInput extends MeasurementValues {
  email: string;
  note?: string;
}

/** What the customer is shown back: either the set now on file, or the news
 * that their edit was filed for the atelier to apply instead. */
export interface UpdateMeasurementsResult {
  outcome: "applied" | "filed";
  measurements?: OrderMeasurements;
}

/** The date stamped on the revision note, in the studio's own reading of it.
 * Formatted here rather than in the block builder so that stays pure. */
function today(): string {
  return new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export async function updateMeasurements(
  orderNumber: string,
  input: UpdateMeasurementsInput,
): Promise<UpdateMeasurementsResult> {
  const order = await findOrderVerification(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }

  // Identity. `resolveEmailVerification` is deliberately not reused: its whole
  // contract is to return `false` (accept, unverified) for the no-email case,
  // and "accept" is the one thing a direct write must not do with it. So the
  // two halves are separated — a contradiction is refused, an absence is
  // delegated below.
  const stored = order.email.trim().toLowerCase();
  const supplied = input.email.trim().toLowerCase();
  if (stored && stored !== supplied) {
    throw new ForbiddenError("That email doesn't match the one on this order.");
  }

  // Checked before the unverifiable-order fallback, so a locked order gets the
  // one true answer (it's being made now) rather than filing a request that
  // would itself be refused.
  if (measurementsLocked(order.currentStage, order.stages)) {
    throw new MeasurementsLockedError(
      "Measurements can no longer be changed once your costume is in production. Please contact us.",
    );
  }

  const note = input.note?.trim();

  // Nothing to verify the edit against — file it for the atelier instead of
  // writing on the strength of an email anyone could type.
  if (!stored) {
    logger.info(
      { orderNumber: orderNumber.trim() },
      "Order carries no email to verify a measurement edit against; filing it as a change request",
    );
    return fileAsChangeRequest(orderNumber, input, note);
  }

  const values: MeasurementValues = {
    waist: input.waist,
    bust: input.bust,
    hips: input.hips,
    height: input.height,
    bodyGirth: input.bodyGirth,
    measurementUnit: input.measurementUnit,
  };
  const previous = order.measurements;

  try {
    await updateOrderMeasurements(order.pageId, values, {
      ...(previous ? { previous } : {}),
      ...(note ? { note } : {}),
      changedOn: today(),
    });
  } catch (err) {
    if (err instanceof MeasurementPropertiesMissingError) {
      // Additive atelier setup that hasn't been done yet. The `warn` names the
      // property to add; the customer's edit still reaches the atelier as a
      // request, so the feature degrades to the flow it replaced rather than
      // to an error.
      logger.warn(
        { property: err.property },
        "The orders database has no such property; measurements can't be edited in place until it is added in Notion. Filing this edit as a change request instead.",
      );
      return fileAsChangeRequest(orderNumber, input, note);
    }
    throw err;
  }

  const measurements: OrderMeasurements = {
    unit: values.measurementUnit,
    waist: values.waist,
    bust: values.bust,
    hips: values.hips,
    height: values.height,
    bodyGirth: values.bodyGirth,
  };

  const trimmedOrderNumber = orderNumber.trim();
  const from = fromAddress("orders");
  await sendEmailBestEffort({
    ...measurementsUpdatedEmail({
      email: input.email,
      orderNumber: trimmedOrderNumber,
      orderName: order.orderName,
      measurements,
      ...(previous ? { previous } : {}),
      ...(note ? { note } : {}),
    }),
    from,
  });

  const inbox = atelierInbox("orders");
  if (inbox) {
    await sendEmailBestEffort({
      ...measurementsUpdatedNotificationEmail({
        email: input.email,
        orderNumber: trimmedOrderNumber,
        orderName: order.orderName,
        currentStage: order.currentStage,
        measurements,
        ...(previous ? { previous } : {}),
        ...(note ? { note } : {}),
        inbox,
      }),
      from,
    });
  }

  return { outcome: "applied", measurements };
}

/**
 * Hand an edit that couldn't be written to the flow that predates it. The
 * values reach the atelier exactly as they would have from the "request a
 * measurement change" dialog — same Notion row, same emails, same unverified
 * flagging — so this needs no second writer and no second inbox convention.
 *
 * It re-reads the order (one extra Notion request on a path taken only by a
 * legacy order or an unconfigured database), which buys the guarantee that
 * matters more: a filed request is byte-for-byte one the request endpoint
 * would have produced, rather than a near-copy that drifts the first time
 * either changes.
 */
async function fileAsChangeRequest(
  orderNumber: string,
  input: UpdateMeasurementsInput,
  note: string | undefined,
): Promise<UpdateMeasurementsResult> {
  await submitMeasurementChangeRequest(orderNumber, {
    email: input.email,
    waist: input.waist,
    bust: input.bust,
    hips: input.hips,
    height: input.height,
    bodyGirth: input.bodyGirth,
    measurementUnit: input.measurementUnit,
    ...(note ? { note } : {}),
  });
  return { outcome: "filed" };
}
