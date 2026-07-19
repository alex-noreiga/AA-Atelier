// Custom-order payment use-cases, independent of HTTP.
//
// The atelier builds the invoice + its itemized lines in Notion ("invoices &
// payments" + "Invoice Line Items"). The invoice is the SOURCE OF TRUTH for
// everything a customer pays online: the first deposit, the second deposit, and
// the final balance. This service reads it to show the customer their payments
// and, on payment, records the paid stage back on the invoice.
//
// All amounts are priced server-side (never trusting the client): deposits from
// the invoice's deposit-amount fields, and the balance as the sum of the line
// items minus the deposits already paid — deposits are credits, not charges, and
// live on the invoice head rather than as line items ("Deposit" is no longer a
// `Line Type` option; the filter in `buildInvoiceView` is a guard against it
// coming back). Only the balance is taxed (Stripe Tax); deposits are untaxed.

import type Stripe from "stripe";
import { findOrderByNumber } from "../lib/notion/orders.repository.js";
import {
  findInvoice,
  listInvoiceLineItems,
  markInvoicePaid,
} from "../lib/notion/invoice.repository.js";
import {
  LINE_TYPE_DEPOSIT,
  type PaymentStage,
  type InvoiceRecord,
  type InvoiceLineItemRecord,
  type InvoiceDepositView,
  type InvoiceView,
} from "../lib/notion/invoice.schema.js";
import type { OrderRecord } from "../lib/notion/orders.schema.js";
import { getStripeClient } from "../lib/stripe/client.js";
import { siteBaseUrl } from "../lib/site.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";

const CURRENCY = "usd";

/** The metadata kind that marks a Checkout session as a custom-order payment
 * (any of the three stages). The webhook routes on this; the shop-success page
 * skips clearing the cart for it. */
export const CUSTOM_PAYMENT_KIND = "custom_payment";

const PAYMENT_STAGES: readonly PaymentStage[] = [
  "first_deposit",
  "second_deposit",
  "balance",
];

/** Round a dollar amount to whole cents, killing float-sum noise. */
function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Build the customer-facing itemized invoice from an invoice head + its line
 * items. Shared by the status lookup (display) and the balance checkout
 * (pricing) so the two can never disagree. Deposits (credits) come from the
 * invoice's own deposit fields; only paid deposits reduce the balance.
 */
export function buildInvoiceView(
  invoice: InvoiceRecord,
  lineItems: InvoiceLineItemRecord[],
): InvoiceView {
  // "Deposit" is no longer an option on the live `Line Type` select, so this is
  // a guard rather than an active filter — see `LINE_TYPE_DEPOSIT`. Keep it:
  // without it, re-adding that option in Notion would bill a customer for their
  // own deposit.
  const charged = lineItems.filter((li) => li.type !== LINE_TYPE_DEPOSIT);

  const subtotal = roundCents(charged.reduce((sum, li) => sum + li.amount, 0));
  const depositsCreditedTotal = roundCents(
    invoice.deposits.reduce((sum, d) => (d.paid ? sum + d.amount : sum), 0),
  );
  const balanceDue = Math.max(0, roundCents(subtotal - depositsCreditedTotal));

  return {
    invoiceId: invoice.invoiceId,
    paid: invoice.balancePaid,
    lineItems: charged,
    subtotal,
    depositsCreditedTotal,
    balanceDue,
    ...(invoice.paymentDeadline !== undefined
      ? { paymentDeadline: invoice.paymentDeadline }
      : {}),
  };
}

/**
 * Read an order's invoice and derive what the status page needs: the staged
 * deposits (payable as soon as the atelier sets an amount, before the itemized
 * invoice is "ready") and — once "Invoice Ready" is flipped — the itemized
 * invoice view. Returns empty deposits + null invoice when there's no invoice.
 */
export async function getInvoicePaymentInfo(
  order: OrderRecord,
): Promise<{ deposits: InvoiceDepositView[]; invoice: InvoiceView | null }> {
  if (!order.invoicePageId) return { deposits: [], invoice: null };
  const invoice = await findInvoice(order.invoicePageId);
  if (!invoice) return { deposits: [], invoice: null };
  if (!invoice.ready) return { deposits: invoice.deposits, invoice: null };
  const lineItems = await listInvoiceLineItems(invoice.pageId);
  return {
    deposits: invoice.deposits,
    invoice: buildInvoiceView(invoice, lineItems),
  };
}

/**
 * Create a Stripe Checkout session for one payment stage of a custom order,
 * priced server-side from the invoice. Deposits are untaxed; the balance is
 * taxed (Stripe Tax) and collects a billing address for it.
 */
export async function createPaymentCheckout(
  orderNumber: string,
  stage: PaymentStage,
  stripe: Stripe = getStripeClient(),
): Promise<{ url: string }> {
  const order = await findOrderByNumber(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }
  if (!order.pageId || !order.invoicePageId) {
    throw new BadRequestError("There's nothing to pay on this order yet.");
  }

  const invoice = await findInvoice(order.invoicePageId);
  if (!invoice) {
    throw new BadRequestError("There's nothing to pay on this order yet.");
  }

  let unitAmount: number;
  let productName: string;
  let taxed = false;

  if (stage === "balance") {
    if (!invoice.ready) {
      throw new BadRequestError("Your invoice isn't ready yet.");
    }
    if (invoice.balancePaid) {
      throw new BadRequestError("This balance has already been paid.");
    }
    const lineItems = await listInvoiceLineItems(invoice.pageId);
    const view = buildInvoiceView(invoice, lineItems);
    if (view.balanceDue <= 0) {
      throw new BadRequestError("There's no balance due on this order.");
    }
    unitAmount = Math.round(view.balanceDue * 100);
    productName = `Balance — ${order.orderName}`;
    taxed = true;
  } else {
    const deposit = invoice.deposits.find((d) => d.stage === stage);
    if (!deposit || deposit.amount <= 0) {
      throw new BadRequestError("There's no deposit due for this stage.");
    }
    if (deposit.paid) {
      throw new BadRequestError("This deposit has already been paid.");
    }
    unitAmount = Math.round(deposit.amount * 100);
    productName = `${deposit.label} — ${order.orderName}`;
  }

  const base = siteBaseUrl();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: unitAmount,
          // The balance is pre-tax; Stripe Tax adds tax on top ("exclusive").
          ...(taxed ? { tax_behavior: "exclusive" as const } : {}),
          product_data: { name: productName },
        },
      },
    ],
    // Tax on the final balance only (deposits are untaxed). Stripe Tax computes
    // it from the collected address; the invoice has no shipping step, so
    // collect a billing address for it.
    ...(taxed
      ? {
          automatic_tax: { enabled: true },
          billing_address_collection: "required" as const,
        }
      : {}),
    success_url: `${base}/shop/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/track`,
    // The webhook reads these to mark the right invoice stage paid.
    metadata: {
      kind: CUSTOM_PAYMENT_KIND,
      stage,
      orderNumber,
      orderPageId: order.pageId,
      invoicePageId: invoice.pageId,
    },
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }
  return { url: session.url };
}

/**
 * Record a completed custom-order payment against its Notion invoice. Called
 * from the Stripe webhook for sessions tagged `kind: "custom_payment"`.
 * Idempotent (the Notion update sets the same values on redelivery). Only paid
 * sessions are recorded.
 */
export async function recordPayment(
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.payment_status !== "paid") {
    return;
  }
  const stage = session.metadata?.stage as PaymentStage | undefined;
  const invoicePageId = session.metadata?.invoicePageId;
  if (!stage || !PAYMENT_STAGES.includes(stage) || !invoicePageId) {
    throw new Error(
      "Payment session is missing a valid stage/invoice metadata",
    );
  }
  await markInvoicePaid(invoicePageId, stage, session.id);
}
