// Order use-cases, independent of HTTP. Route handlers call these with already
// validated input and turn the results (or thrown domain errors) into responses.

import {
  createOrder,
  findOrderByNumber,
} from "../lib/notion/orders.repository.js";
import type { CreateOrderInput, OrderRecord } from "../lib/notion/schema.js";
import { NotFoundError } from "../lib/errors.js";
import { orderConfirmationEmail } from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";

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
  const orderNumber = await createOrder(input);
  // Best-effort confirmation email; a mail failure must not fail the order.
  await sendEmailBestEffort(orderConfirmationEmail(input, orderNumber));
  return { orderNumber };
}
