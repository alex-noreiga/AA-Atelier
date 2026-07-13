// Custom-order deposit use-cases, independent of HTTP.
//
// Flow: after quoting a custom order, the atelier sets a "Deposit Amount" on it
// in Notion. The customer pays that deposit from the order-status page; this
// service prices it server-side (never trusting the client) and creates a
// Stripe Checkout session. The webhook then marks the order's deposit paid.

import type Stripe from "stripe";
import {
  findDepositTarget,
  markDepositPaid,
} from "../lib/notion/orders.repository.js";
import { getStripeClient } from "../lib/stripe/client.js";
import { siteBaseUrl } from "../lib/site.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";

const CURRENCY = "usd";

/** The metadata kind that marks a Checkout session as a deposit payment. */
export const DEPOSIT_SESSION_KIND = "deposit";

export async function createDepositCheckout(
  orderNumber: string,
  stripe: Stripe = getStripeClient(),
): Promise<{ url: string }> {
  const order = await findDepositTarget(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }
  if (typeof order.depositAmount !== "number" || order.depositAmount <= 0) {
    throw new BadRequestError("There's no deposit due on this order.");
  }
  if (order.depositPaid) {
    throw new BadRequestError("This deposit has already been paid.");
  }

  const base = siteBaseUrl();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: Math.round(order.depositAmount * 100),
          product_data: { name: `Deposit — ${order.orderName}` },
        },
      },
    ],
    success_url: `${base}/shop/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/shop/status`,
    // The webhook reads these to mark the right order's deposit paid.
    metadata: {
      kind: DEPOSIT_SESSION_KIND,
      orderNumber,
      orderPageId: order.pageId,
    },
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }
  return { url: session.url };
}

/**
 * Record a completed deposit payment against its Notion order. Called from the
 * Stripe webhook for sessions tagged `kind: "deposit"`. Idempotent (the Notion
 * update sets the same values on redelivery). Only paid sessions are recorded.
 */
export async function recordDepositPayment(
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.payment_status !== "paid") {
    return;
  }
  const pageId = session.metadata?.orderPageId;
  if (!pageId) {
    throw new Error("Deposit session is missing orderPageId metadata");
  }
  await markDepositPaid(pageId, session.id);
}
