// Order use-cases, independent of HTTP. Route handlers call these with already
// validated input and turn the results (or thrown domain errors) into responses.

import {
  createOrder,
  findOrderByNumber,
} from "../lib/notion/orders.repository.js";
import { upsertClientByEmail } from "../lib/notion/clients.repository.js";
import {
  findInvoiceById,
  computeBalanceDue,
} from "../lib/notion/invoices.repository.js";
import type {
  CreateOrderInput,
  OrderRecord,
  OrderLookup,
} from "../lib/notion/orders.schema.js";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import {
  orderConfirmationEmail,
  orderNotificationEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";
import { logger } from "../lib/logger.js";

const MEASUREMENT_FIELDS = [
  "waist",
  "bust",
  "hips",
  "height",
  "bodyGirth",
] as const;

/** True when every body measurement is present as a number. */
function hasAllMeasurements(input: CreateOrderInput): boolean {
  return MEASUREMENT_FIELDS.every((field) => typeof input[field] === "number");
}

export async function getOrderStatus(
  orderNumber: string,
): Promise<OrderRecord> {
  const order = await findOrderByNumber(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }

  // The current stage may not be present in the live options list (e.g. a
  // renamed/removed option); ensure the timeline still includes it.
  const stages = order.stages.includes(order.currentStage)
    ? order.stages
    : [...order.stages, order.currentStage];

  // `invoicePageId` is internal (used only to read the balance) — strip it from
  // the response.
  const { invoicePageId, ...record } = order;

  return { ...record, stages, ...(await balanceFields(order)) };
}

/**
 * Best-effort final-balance state for the status page, read from the order's
 * linked invoice. Returns nothing when there's no invoice, the invoices db isn't
 * configured, or the read fails — the status page then simply shows no balance
 * action rather than erroring the whole lookup.
 */
async function balanceFields(order: OrderLookup): Promise<{
  balanceAmount?: number;
  balancePaid?: boolean;
  balanceReady?: boolean;
}> {
  try {
    const invoice = await findInvoiceById(order.invoicePageId);
    if (!invoice) return {};

    const depositPaid = order.depositPaid ?? false;
    const balanceDue = computeBalanceDue(
      invoice.finalBalance,
      order.depositAmount,
      depositPaid,
    );
    // A deposit the atelier set must be paid before the balance can be.
    const depositOutstanding =
      typeof order.depositAmount === "number" &&
      order.depositAmount > 0 &&
      !depositPaid;

    return {
      ...(balanceDue > 0 ? { balanceAmount: balanceDue } : {}),
      balancePaid: invoice.balancePaid,
      balanceReady:
        invoice.invoiceReady &&
        !invoice.balancePaid &&
        !depositOutstanding &&
        balanceDue > 0,
    };
  } catch (err) {
    logger.warn(
      { err },
      "Failed to read invoice balance; showing the order without a balance action",
    );
    return {};
  }
}

export async function submitOrder(
  input: CreateOrderInput,
): Promise<{ orderNumber: string }> {
  // The generated (flat) schema can't express this: measurements are optional,
  // but only because the customer may instead ask to have them taken at a
  // fitting/consultation. Reject a body that offers neither.
  if (!input.measurementAppointment && !hasAllMeasurements(input)) {
    throw new ValidationError(
      "Please enter your measurements or request a measurement appointment.",
    );
  }

  // Best-effort: mirror the customer into the Client CRM (dedupe by email) so we
  // can link the order to a durable client record. A CRM failure must never fail
  // the order — swallow and log, like the mailers below — and when the CRM db
  // isn't configured `upsertClientByEmail` simply returns null (no link).
  let clientPageId: string | undefined;
  try {
    clientPageId =
      (await upsertClientByEmail({
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
      })) ?? undefined;
  } catch (err) {
    logger.warn(
      { err },
      "Failed to upsert Client CRM record; creating the order without a client link",
    );
  }

  const orderNumber = await createOrder(input, undefined, clientPageId);

  // Best-effort emails; a mail failure must not fail the order.
  const from = fromAddress("orders");
  await sendEmailBestEffort({
    ...orderConfirmationEmail(input, orderNumber),
    from,
  });
  const inbox = atelierInbox("orders");
  if (inbox) {
    await sendEmailBestEffort({
      ...orderNotificationEmail(input, orderNumber, inbox),
      from,
    });
  }
  return { orderNumber };
}
