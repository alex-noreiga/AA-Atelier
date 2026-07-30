// The atelier-facing half of order cancellation: issue Stripe refunds for an
// order's paid payments and mark it cancelled. Triggered from a CRON_SECRET-gated
// link the atelier clicks (routes/order-cancellation.ts), the same "review, then
// action a button" pattern as the invoice generator and stage-change link — NOT
// a customer request. The customer files the request (cancellation.service); the
// atelier reviews and processes the refund here.
//
// Money rules that keep this safe on Stripe's at-least-once, re-pressable world:
//   - Refunds are IDEMPOTENT. Stripe does NOT dedupe `refunds.create` the way it
//     dedupes charges, so we `refunds.list` first and skip if any refund already
//     exists (including one the atelier issued by hand in the Dashboard). We also
//     pass an idempotency key for concurrent-press safety. So we never double-refund.
//   - A $0 / fully-promo session has no payment_intent — skipped, never dereferenced.
//   - A paid stage with no recorded session id (paid offline) can't be refunded via
//     Stripe — surfaced as "manual refund needed", not a failure.
//   - A per-session throw (e.g. a test-mode session id retrieved under a live key)
//     is caught, logged at `error`, recorded in the summary, and the run continues.
//   - The order is marked `Cancelled` ONLY after every attempted refund succeeded
//     (no error), so a partial failure leaves it uncancelled and a re-press retries
//     — safe because the refund pass itself is idempotent.

import type Stripe from "stripe";
import { getStripeClient } from "../lib/stripe/client.js";
import {
  findOrderForCancellation,
  setOrderCancelled,
} from "../lib/notion/orders.repository.js";
import {
  findShopOrderForCancellation,
  setShopOrderCancelled,
} from "../lib/notion/shop-orders.repository.js";
import { findInvoice } from "../lib/notion/invoice.repository.js";
import { NotFoundError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { cancellationRefundEmail } from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress } from "../lib/resend/config.js";

/** A single payment to attempt a refund on: a human label + the Stripe Checkout
 * session id it was collected through (blank when the stage was paid without a
 * recorded session — e.g. offline). */
interface RefundTarget {
  label: string;
  sessionId: string;
}

type SessionRefundStatus =
  "refunded" | "already_refunded" | "no_payment" | "error";

interface SessionRefundResult {
  label: string;
  status: SessionRefundStatus;
  /** Dollars refunded this run (0 unless status === "refunded"). */
  amount: number;
  message?: string;
}

/** The outcome of processing a cancellation, for the JSON / HTML confirmation. */
export interface CancellationResult {
  orderType: "custom" | "shop";
  orderNumber: string;
  refundsIssued: number;
  totalRefunded: number;
  /** True when the order was already cancelled before this run (a re-press). */
  alreadyCancelled: boolean;
  /** True when this run flipped the order to cancelled. */
  cancelledNow: boolean;
  /** True when at least one refund attempt errored (order left uncancelled). */
  hadError: boolean;
  /** Human notes for anything not newly refunded (already refunded, no payment,
   * manual refund needed, or an error), for the atelier's summary. */
  skipped: string[];
}

/**
 * Refund a single Checkout session, idempotently. Retrieves the session to read
 * its payment_intent, skips if a refund already exists, else issues a full refund.
 * Never throws — a failure is captured as `status: "error"` so the caller can
 * record it and keep refunding the order's other payments.
 */
export async function refundCheckoutSession(
  target: RefundTarget,
  stripe: Stripe = getStripeClient(),
): Promise<SessionRefundResult> {
  const { label, sessionId } = target;
  if (!sessionId.trim()) {
    return {
      label,
      status: "no_payment",
      amount: 0,
      message: "no Stripe session recorded — refund manually",
    };
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paymentIntent =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);

    if (!paymentIntent) {
      return {
        label,
        status: "no_payment",
        amount: 0,
        message: "no payment to refund",
      };
    }

    // Stripe doesn't dedupe refunds.create — check first so a re-press can't
    // double-refund (also catches a refund the atelier issued by hand).
    const existing = await stripe.refunds.list({
      payment_intent: paymentIntent,
      limit: 1,
    });
    if (existing.data.length > 0) {
      return { label, status: "already_refunded", amount: 0 };
    }

    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntent },
      { idempotencyKey: `refund_${paymentIntent}` },
    );
    return { label, status: "refunded", amount: (refund.amount ?? 0) / 100 };
  } catch (err) {
    // A mode-mismatched/deleted session, or a Stripe hiccup — don't 500 the whole
    // run; surface it and let the atelier reconcile / re-press.
    logger.error({ err, sessionId }, "Failed to refund checkout session");
    return {
      label,
      status: "error",
      amount: 0,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Format a per-target result as a short atelier-facing note. */
function noteFor(result: SessionRefundResult): string {
  switch (result.status) {
    case "already_refunded":
      return `${result.label}: already refunded`;
    case "no_payment":
      return `${result.label}: ${result.message ?? "no payment"}`;
    case "error":
      return `${result.label}: refund failed (${result.message ?? "unknown error"})`;
    default:
      return `${result.label}: refunded`;
  }
}

/**
 * Aggregate the per-session refund results, mark the order cancelled when nothing
 * errored, and send a best-effort refund confirmation to the customer when the
 * run did something new (issued a refund, or newly cancelled the order).
 */
async function finalize(
  orderType: "custom" | "shop",
  orderNumber: string,
  email: string,
  alreadyCancelled: boolean,
  results: SessionRefundResult[],
  markCancelled: () => Promise<void>,
): Promise<CancellationResult> {
  const refunded = results.filter((r) => r.status === "refunded");
  const refundsIssued = refunded.length;
  const totalRefunded =
    Math.round(refunded.reduce((sum, r) => sum + r.amount, 0) * 100) / 100;
  const hadError = results.some((r) => r.status === "error");
  const skipped = results.filter((r) => r.status !== "refunded").map(noteFor);

  // Mark cancelled only when every attempted refund succeeded — a partial failure
  // is left uncancelled so a re-press retries (the refund pass is idempotent).
  let cancelledNow = false;
  if (!hadError && !alreadyCancelled) {
    await markCancelled();
    cancelledNow = true;
  }

  // Best-effort customer email, only when something new happened this run and the
  // order carries an email. A re-press that changed nothing sends nothing.
  if (!hadError && email.trim() && (refundsIssued > 0 || cancelledNow)) {
    await sendEmailBestEffort({
      ...cancellationRefundEmail(email, orderNumber, totalRefunded),
      from: fromAddress("orders"),
    });
  }

  return {
    orderType,
    orderNumber,
    refundsIssued,
    totalRefunded,
    alreadyCancelled,
    cancelledNow,
    hadError,
    skipped,
  };
}

async function processCustomCancellation(
  orderNumber: string,
  stripe: Stripe,
): Promise<CancellationResult> {
  const order = await findOrderForCancellation(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }

  // Collect the paid payments to refund from the invoice: each paid deposit +
  // the paid balance. A paid stage with no session id is still listed (with a
  // blank id) so it surfaces as "refund manually" rather than being silently lost.
  const targets: RefundTarget[] = [];
  if (order.invoicePageId) {
    const invoice = await findInvoice(order.invoicePageId);
    if (invoice) {
      for (const deposit of invoice.deposits) {
        if (deposit.paid) {
          targets.push({
            label: deposit.label,
            sessionId: deposit.sessionId ?? "",
          });
        }
      }
      if (invoice.balancePaid) {
        targets.push({
          label: "Balance",
          sessionId: invoice.balanceSessionId ?? "",
        });
      }
    }
  }

  const results: SessionRefundResult[] = [];
  for (const target of targets) {
    results.push(await refundCheckoutSession(target, stripe));
  }

  return finalize(
    "custom",
    order.orderNumber,
    order.email,
    order.cancelled,
    results,
    () => setOrderCancelled(order.pageId),
  );
}

async function processShopCancellation(
  orderNumber: string,
  stripe: Stripe,
): Promise<CancellationResult> {
  const order = await findShopOrderForCancellation(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find a shop order with that number.");
  }

  const results = [
    await refundCheckoutSession(
      { label: "Order", sessionId: order.sessionId },
      stripe,
    ),
  ];

  return finalize(
    "shop",
    order.orderNumber,
    order.email,
    order.cancelled,
    results,
    () => setShopOrderCancelled(order.pageId),
  );
}

/**
 * Process a cancellation for either a custom or a shop order. The order type is
 * detected by the number's prefix (shop orders are minted `SHP-…`); the actual
 * lookup confirms it exists (404 otherwise).
 */
export async function processCancellation(
  orderNumber: string,
  stripe: Stripe = getStripeClient(),
): Promise<CancellationResult> {
  const trimmed = orderNumber.trim();
  if (!trimmed) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }
  return trimmed.toUpperCase().startsWith("SHP-")
    ? processShopCancellation(trimmed, stripe)
    : processCustomCancellation(trimmed, stripe);
}
