// Order use-cases, independent of HTTP. Route handlers call these with already
// validated input and turn the results (or thrown domain errors) into responses.

import {
  createOrder,
  findOrderByNumber,
} from "../lib/notion/orders.repository.js";
import type { CreateOrderInput, OrderRecord } from "../lib/notion/schema.js";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import {
  orderConfirmationEmail,
  orderNotificationEmail,
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

  return { ...order, stages };
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

  const orderNumber = await createOrder(input);
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
