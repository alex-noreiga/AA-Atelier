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
import {
  findOrderByNumber,
  findOrderForStageNotification,
} from "../lib/notion/orders.repository.js";
import {
  findInvoice,
  listInvoiceLineItems,
  markInvoicePaid,
} from "../lib/notion/invoice.repository.js";
import { runPaidOrderRewards } from "./rewards.service.js";
import { recordStripeCharge } from "./payment-ledger.service.js";
import { logger } from "../lib/logger.js";
import {
  chargedLinesOf,
  issuedIdentity,
  readIssuedInvoice,
  type IssuedInvoice,
} from "./invoice-issue.service.js";
import { readCreditNotes, type CreditNote } from "./credit-note.service.js";
import {
  invoiceChargedTotal,
  type PaymentStage,
  type InvoiceRecord,
  type InvoiceLineItemRecord,
  type InvoiceDepositView,
  type InvoiceView,
} from "../lib/notion/invoice.schema.js";
import type { OrderRecord } from "../lib/notion/orders.schema.js";
import { resolveStoredOrderService } from "../lib/service-catalog.js";
import { labelDeposits } from "./payment-labels.js";
import { getStripeClient } from "../lib/stripe/client.js";
import { bnplPaymentMethodTypes } from "../lib/stripe/payment-methods.js";
import { siteBaseUrl } from "../lib/site.js";
import {
  BadRequestError,
  NotFoundError,
  ServiceUnavailableError,
} from "../lib/errors.js";

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
  issued: IssuedInvoice | null = null,
  credits: CreditNote[] = [],
): InvoiceView {
  // The charges come from the ISSUED snapshot when the invoice has been issued,
  // and from the live Notion rows when it hasn't (a legacy invoice, or a
  // Postgres outage). That choice is `chargedLinesOf`, in one place, so this
  // view, its PDF and the balance checkout can never disagree about which
  // document they are looking at.
  //
  // Which lines are charges, and what they come to, are then the SHARED rule in
  // `invoice.schema.ts` — the studio's own figures derive an invoice's value the
  // same way, so the customer's total and the dashboard's can't drift. ("Deposit"
  // is no longer a live `Line Type` option; the filter is a guard, kept because
  // without it re-adding that option in Notion would bill a customer for their
  // own deposit.)
  const charged = chargedLinesOf(issued, lineItems);
  const subtotal = invoiceChargedTotal(charged);

  // Credit notes reduce what the invoice CHARGES, so they come off before the
  // deposits already paid are credited against it. The service caps the credits
  // on an invoice at its own subtotal, so this can't go negative — but it is
  // floored anyway, because an arithmetic invariant enforced two files away is
  // one nobody reads.
  const creditsTotal = roundCents(
    credits.reduce((sum, note) => sum + note.amountCents / 100, 0),
  );
  const charges = Math.max(0, roundCents(subtotal - creditsTotal));

  const depositsCreditedTotal = roundCents(
    invoice.deposits.reduce((sum, d) => (d.paid ? sum + d.amount : sum), 0),
  );
  const balanceDue = Math.max(0, roundCents(charges - depositsCreditedTotal));

  const identity = issuedIdentity(issued);

  return {
    invoiceId: invoice.invoiceId,
    ...(identity ?? {}),
    paid: invoice.balancePaid,
    lineItems: charged,
    subtotal,
    ...(credits.length > 0
      ? {
          creditsTotal,
          credits: credits.map((note) => ({
            creditNumber: note.creditNumber,
            issuedAt: note.issuedAt.toISOString(),
            amount: note.amountCents / 100,
            reason: note.reason,
          })),
        }
      : {}),
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
  // The invoice holds the same three stages for every order; the order's service
  // decides what they're CALLED. A repair paid in one go reads "Deposit", not
  // "First deposit" — see `services/payment-labels.ts`. Nothing about the
  // amounts, the stages or which are payable changes here.
  const { payment } = resolveStoredOrderService(order.service);
  const deposits = labelDeposits(invoice.deposits, payment);
  if (!invoice.ready) return { deposits, invoice: null };
  const [lineItems, issued, creditRead] = await Promise.all([
    listInvoiceLineItems(invoice.pageId),
    readIssuedInvoice(invoice.pageId),
    readCreditNotes(invoice.pageId),
  ]);
  return {
    deposits,
    // A credits read that failed shows the invoice UNcredited here. That is the
    // recoverable direction for a display; the checkout below refuses instead,
    // because charging an unconfirmed balance is not recoverable.
    invoice: buildInvoiceView(invoice, lineItems, issued, creditRead.credits),
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

  // Same relabelling as the status page, so the wording on Stripe's hosted
  // checkout matches the button the customer pressed to get there. (Only the
  // deposits are affected — the balance already reads "Balance" for everyone.)
  const deposits = labelDeposits(
    invoice.deposits,
    resolveStoredOrderService(order.service).payment,
  );

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
    // Priced from the ISSUED document where there is one. Reading the live rows
    // here while showing the customer a snapshot would be the sharpest form of
    // the bug this closes: shown one total, charged another.
    const [lineItems, issued, creditRead] = await Promise.all([
      listInvoiceLineItems(invoice.pageId),
      readIssuedInvoice(invoice.pageId),
      readCreditNotes(invoice.pageId),
    ]);
    if (creditRead.unavailable) {
      // We could not confirm what this invoice has been credited, and an
      // uncredited invoice charges its FULL amount — so a blip here would take
      // money from a customer who had been credited. Refuse, retriably, rather
      // than price a document we can't read.
      throw new ServiceUnavailableError(
        "We couldn't confirm your invoice just now. Please try again in a moment.",
      );
    }
    const view = buildInvoiceView(
      invoice,
      lineItems,
      issued,
      creditRead.credits,
    );
    if (view.balanceDue <= 0) {
      throw new BadRequestError("There's no balance due on this order.");
    }
    unitAmount = Math.round(view.balanceDue * 100);
    productName = `Balance — ${order.orderName}`;
    taxed = true;
  } else {
    const deposit = deposits.find((d) => d.stage === stage);
    if (!deposit || deposit.amount <= 0) {
      throw new BadRequestError("There's no deposit due for this stage.");
    }
    if (deposit.paid) {
      throw new BadRequestError("This deposit has already been paid.");
    }
    unitAmount = Math.round(deposit.amount * 100);
    productName = `${deposit.label} — ${order.orderName}`;
  }

  // Offer buy-now-pay-later (Klarna / Affirm / Afterpay) on the final BALANCE
  // only, when STRIPE_BNPL_METHODS is configured. The balance collects a billing
  // address (below) that BNPL needs, and it's a real invoiceable amount — deposits
  // are partial pre-payments and stay card-only. Unset ⇒ undefined ⇒ dynamic
  // payment methods, unchanged. See lib/stripe/payment-methods.ts.
  const paymentMethodTypes = taxed ? bnplPaymentMethodTypes() : undefined;

  const base = siteBaseUrl();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    ...(paymentMethodTypes ? { payment_method_types: paymentMethodTypes } : {}),
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
    // Let a customer redeem a promo code or gift card on Stripe's hosted page —
    // for deposits and the balance alike — mirroring the shop cart. Stripe renders
    // the redemption box and applies codes/gift cards created in the Stripe
    // Dashboard, so the atelier can run returning-skater comps or honor a gift
    // card with no code or contract change. On the taxed balance, Stripe recomputes
    // tax on the post-discount amount.
    allow_promotion_codes: true,
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

  const orderNumber = session.metadata?.orderNumber;

  // The payment ledger. The invoice records THAT this stage was paid; the ledger
  // records when, how much actually arrived (tax included — it is a cash record,
  // not a restatement of the invoice) and against which Stripe session. That
  // timestamp is the whole reason it exists: a checkbox cannot say which month
  // the money landed in, which is why bespoke work has only ever been reportable
  // as *booked*. Best-effort and never throwing — see payment-ledger.service.
  if (orderNumber) {
    await recordStripeCharge({
      orderNumber,
      orderKind: "custom",
      stage,
      session,
    });
  }

  // Best-effort referral / returning-skater rewards on the paid custom order (see
  // rewards.service). The reward passes are idempotent by the CRM flags + the
  // first-paid-order number, so running on every payment stage (not just the
  // first deposit) can't double-issue. A failure must never bubble into the
  // webhook — swallow and log, like the shop path.
  if (orderNumber) {
    try {
      const order = await findOrderForStageNotification(orderNumber);
      if (order?.email) {
        await runPaidOrderRewards(order.email, orderNumber);
      }
    } catch (err) {
      logger.warn(
        { err },
        "Failed to run rewards for a paid custom order; the payment is recorded",
      );
    }
  }
}
