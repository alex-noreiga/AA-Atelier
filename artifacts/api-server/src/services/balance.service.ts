// Custom-order final-balance use-cases, independent of HTTP.
//
// Flow: after the deposit, the atelier builds a ready invoice (line items → a
// `Final Balance`) linked to the order. The customer pays the remaining balance
// from the order-status page; this service prices it server-side (never trusting
// the client) as the invoice's final balance minus any deposit already paid, adds
// tax via Stripe Tax, and creates a Stripe Checkout session. The webhook then
// marks the invoice's balance paid.

import type Stripe from "stripe";
import { findDepositTarget } from "../lib/notion/orders.repository.js";
import {
  findInvoiceById,
  markBalancePaid,
  computeBalanceDue,
} from "../lib/notion/invoices.repository.js";
import { getStripeClient } from "../lib/stripe/client.js";
import { siteBaseUrl } from "../lib/site.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";

const CURRENCY = "usd";

/** The metadata kind that marks a Checkout session as a balance payment. */
export const BALANCE_SESSION_KIND = "balance";

export async function createBalanceCheckout(
  orderNumber: string,
  stripe: Stripe = getStripeClient(),
): Promise<{ url: string }> {
  const order = await findDepositTarget(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }

  const invoice = await findInvoiceById(order.invoicePageId);
  if (!invoice) {
    throw new BadRequestError("There's no invoice ready for this order yet.");
  }
  if (!invoice.invoiceReady) {
    throw new BadRequestError("This invoice isn't ready for payment yet.");
  }
  if (invoice.balancePaid) {
    throw new BadRequestError("This balance has already been paid.");
  }
  // A deposit is paid before the balance — don't let the balance be paid while a
  // deposit the atelier set is still outstanding.
  if (
    typeof order.depositAmount === "number" &&
    order.depositAmount > 0 &&
    !order.depositPaid
  ) {
    throw new BadRequestError("Please pay your deposit first.");
  }

  const balanceDue = computeBalanceDue(
    invoice.finalBalance,
    order.depositAmount,
    order.depositPaid,
  );
  if (balanceDue <= 0) {
    throw new BadRequestError("There's no balance due on this order.");
  }

  const base = siteBaseUrl();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: Math.round(balanceDue * 100),
          // Listed as pre-tax; Stripe Tax adds tax on top ("exclusive").
          tax_behavior: "exclusive",
          product_data: { name: `Balance — ${order.orderName}` },
        },
      },
    ],
    // Unlike the deposit, the final balance is taxed (tax is assessed on the
    // balance, not the deposit). Stripe Tax computes it from the address Checkout
    // collects; configure the origin + default tax category in the Dashboard.
    automatic_tax: { enabled: true },
    success_url: `${base}/shop/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/shop/status`,
    // The webhook reads these to mark the right invoice's balance paid.
    metadata: {
      kind: BALANCE_SESSION_KIND,
      orderNumber,
      invoicePageId: order.invoicePageId ?? "",
    },
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }
  return { url: session.url };
}

/**
 * Record a completed balance payment against its Notion invoice. Called from the
 * Stripe webhook for sessions tagged `kind: "balance"`. Idempotent (the Notion
 * update sets the same values on redelivery). Only paid sessions are recorded.
 */
export async function recordBalancePayment(
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.payment_status !== "paid") {
    return;
  }
  const invoicePageId = session.metadata?.invoicePageId;
  if (!invoicePageId) {
    throw new Error("Balance session is missing invoicePageId metadata");
  }
  await markBalancePaid(invoicePageId, session.id);
}
