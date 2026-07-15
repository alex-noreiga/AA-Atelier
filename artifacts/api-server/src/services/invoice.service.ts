// Custom-order invoice use-cases, independent of HTTP.
//
// The atelier builds the invoice + its itemized lines in Notion ("invoices &
// payments" + "Invoice Line Items"). This service READS that to show the
// customer their balance and, on payment, records it. The balance is computed
// server-side (never trusting the client): the sum of the non-deposit line
// items minus the deposits already paid on the order — deposits are credits, not
// charges, so a "Deposit" line is excluded from the subtotal to avoid double-
// counting. Only the balance is taxed (Stripe Tax); deposits are untaxed.

import type Stripe from "stripe";
import { findOrderByNumber } from "../lib/notion/orders.repository.js";
import {
  findInvoice,
  listInvoiceLineItems,
  markBalancePaid,
} from "../lib/notion/invoice.repository.js";
import {
  LINE_TYPE_DEPOSIT,
  type InvoiceRecord,
  type InvoiceLineItemRecord,
  type InvoiceDepositView,
  type InvoiceView,
} from "../lib/notion/invoice.schema.js";
import type { OrderRecord } from "../lib/notion/schema.js";
import { getStripeClient } from "../lib/stripe/client.js";
import { siteBaseUrl } from "../lib/site.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";

const CURRENCY = "usd";

/** The metadata kind that marks a Checkout session as an invoice-balance payment. */
export const INVOICE_SESSION_KIND = "invoice";

/** Round a dollar amount to whole cents, killing float-sum noise. */
function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** The deposits set on an order, as credit rows (only paid ones reduce the balance). */
function orderDeposits(order: OrderRecord): InvoiceDepositView[] {
  const deposits: InvoiceDepositView[] = [];
  if (typeof order.depositAmount === "number") {
    deposits.push({
      label: "Deposit 1",
      amount: order.depositAmount,
      paid: order.depositPaid ?? false,
    });
  }
  if (typeof order.deposit2Amount === "number") {
    deposits.push({
      label: "Deposit 2",
      amount: order.deposit2Amount,
      paid: order.deposit2Paid ?? false,
    });
  }
  return deposits;
}

/**
 * Build the customer-facing invoice view from an order + its invoice + line
 * items. Shared by `getOrderStatus` (display) and `createInvoiceCheckout`
 * (pricing) so the two can never disagree.
 */
export function buildInvoiceView(
  order: OrderRecord,
  invoice: InvoiceRecord,
  lineItems: InvoiceLineItemRecord[],
): InvoiceView {
  const charged = lineItems.filter((li) => li.type !== LINE_TYPE_DEPOSIT);
  const deposits = orderDeposits(order);

  const subtotal = roundCents(charged.reduce((sum, li) => sum + li.amount, 0));
  const depositsCreditedTotal = roundCents(
    deposits.reduce((sum, d) => (d.paid ? sum + d.amount : sum), 0),
  );
  const balanceDue = Math.max(0, roundCents(subtotal - depositsCreditedTotal));

  return {
    invoiceId: invoice.invoiceId,
    paid: invoice.balancePaid,
    lineItems: charged,
    deposits,
    subtotal,
    depositsCreditedTotal,
    balanceDue,
    ...(invoice.paymentDeadline !== undefined
      ? { paymentDeadline: invoice.paymentDeadline }
      : {}),
  };
}

/**
 * Read an order's ready invoice and build its view, or return null when there's
 * no invoice or the atelier hasn't flipped "Invoice Ready" yet. Used by the
 * status lookup to decide whether to surface the invoice at all.
 */
export async function getInvoiceView(
  order: OrderRecord,
): Promise<InvoiceView | null> {
  if (!order.invoicePageId) return null;
  const invoice = await findInvoice(order.invoicePageId);
  if (!invoice || !invoice.ready) return null;
  const lineItems = await listInvoiceLineItems(invoice.pageId);
  return buildInvoiceView(order, invoice, lineItems);
}

export async function createInvoiceCheckout(
  orderNumber: string,
  stripe: Stripe = getStripeClient(),
): Promise<{ url: string }> {
  const order = await findOrderByNumber(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }
  if (!order.pageId || !order.invoicePageId) {
    throw new BadRequestError("Your invoice isn't ready yet.");
  }

  const invoice = await findInvoice(order.invoicePageId);
  if (!invoice || !invoice.ready) {
    throw new BadRequestError("Your invoice isn't ready yet.");
  }
  if (invoice.balancePaid) {
    throw new BadRequestError("This balance has already been paid.");
  }

  const lineItems = await listInvoiceLineItems(invoice.pageId);
  const view = buildInvoiceView(order, invoice, lineItems);
  if (view.balanceDue <= 0) {
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
          unit_amount: Math.round(view.balanceDue * 100),
          // The balance is pre-tax; Stripe Tax adds tax on top ("exclusive").
          tax_behavior: "exclusive",
          product_data: { name: `Balance — ${order.orderName}` },
        },
      },
    ],
    // Tax on the final balance (deposits were untaxed). Stripe Tax computes it
    // from the collected address; the invoice has no shipping step, so collect a
    // billing address for it. Configure the origin + default tax category in the
    // Stripe Dashboard or this computes $0.
    automatic_tax: { enabled: true },
    billing_address_collection: "required",
    success_url: `${base}/shop/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/shop/status`,
    // The webhook reads these to mark the right order + invoice paid.
    metadata: {
      kind: INVOICE_SESSION_KIND,
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
 * Record a completed invoice-balance payment against its Notion order + invoice.
 * Called from the Stripe webhook for sessions tagged `kind: "invoice"`.
 * Idempotent (the Notion updates set the same values on redelivery). Only paid
 * sessions are recorded.
 */
export async function recordInvoicePayment(
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.payment_status !== "paid") {
    return;
  }
  const orderPageId = session.metadata?.orderPageId;
  const invoicePageId = session.metadata?.invoicePageId;
  if (!orderPageId || !invoicePageId) {
    throw new Error("Invoice session is missing order/invoice page metadata");
  }
  await markBalancePaid(orderPageId, invoicePageId, session.id);
}
