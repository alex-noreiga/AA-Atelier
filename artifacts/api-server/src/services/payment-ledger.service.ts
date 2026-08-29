// Recording money in the payment ledger — the best-effort layer between the
// flows that move money and `lib/db/payments.repository`.
//
// Two rules govern everything here, and they pull in the same direction:
//
//   1. NEVER THROW INTO A MONEY PATH. Every caller is either the Stripe webhook
//      (where a throw makes Stripe redeliver, and the redelivery early-returns
//      at the dedupe guard — losing the write it was retrying for) or a refund
//      that has ALREADY moved money (where a throw would report a failure for
//      something that succeeded). So a ledger failure is caught and logged, and
//      the caller carries on.
//   2. LOG AT `error`, NOT `warn`. A missed row does not announce itself: it
//      silently understates a month's takings, and nothing downstream can tell
//      the difference between "no payment" and "a payment we failed to write".
//      Same reasoning as the shop's order-lines write.
//
// Unconfigured Postgres is a no-op, like every other degrade-safe caller of the
// Postgres layer — the payment itself is unaffected, there is simply no ledger.

import type Stripe from "stripe";
import { postgresConfigured } from "../lib/db/client.js";
import {
  recordPaymentEntry,
  type PaymentOrderKind,
} from "../lib/db/payments.repository.js";
import { logger } from "../lib/logger.js";

/** Stripe's unix-seconds timestamps → a Date. */
function fromUnix(seconds: number): Date {
  return new Date(seconds * 1000);
}

/**
 * When the money moved, to the best timestamp the caller already holds.
 *
 * Prefer the payment intent's `created` (the instant of the charge) when the
 * session was retrieved with `payment_intent` expanded, and fall back to the
 * session's own `created` (when checkout was opened) otherwise. The two differ
 * by the minutes a customer spends typing a card number, which matters for
 * exactly one thing — an order paid either side of midnight on the last of the
 * month — so it is worth taking the exact value where it is free and not worth
 * an extra Stripe round-trip where it isn't.
 */
function chargePaidAt(session: Stripe.Checkout.Session): Date {
  const intent = session.payment_intent;
  if (
    intent &&
    typeof intent !== "string" &&
    typeof intent.created === "number"
  ) {
    return fromUnix(intent.created);
  }
  return fromUnix(session.created);
}

function paymentIntentIdOf(session: Stripe.Checkout.Session): string {
  const intent = session.payment_intent;
  if (!intent) return "";
  return typeof intent === "string" ? intent : intent.id;
}

/**
 * Record a completed Checkout session as a charge.
 *
 * The amount is the session's `amount_total` — what was actually collected,
 * including tax and shipping and after any promotion code. This is a CASH
 * ledger, not a restatement of the invoice: it answers "what came in", which is
 * why it can differ from the invoice's subtotal and should.
 *
 * Idempotent on the session id, so a webhook redelivery records nothing further.
 */
export async function recordStripeCharge(input: {
  orderNumber: string;
  orderKind: PaymentOrderKind;
  stage?: string;
  session: Stripe.Checkout.Session;
}): Promise<void> {
  if (!postgresConfigured()) return;
  const { orderNumber, orderKind, stage, session } = input;
  if (!orderNumber.trim()) {
    // The order number is the ledger's join key; a row without one could never
    // be attributed to anything. Only a legacy session predating the minted
    // numbers can reach this.
    logger.error(
      { sessionId: session.id },
      "Paid session has no order number; the payment is not in the ledger",
    );
    return;
  }

  try {
    await recordPaymentEntry({
      orderNumber,
      orderKind,
      ...(stage ? { stage } : {}),
      kind: "charge",
      amountCents: session.amount_total ?? 0,
      currency: session.currency ?? "usd",
      method: "stripe",
      paidAt: chargePaidAt(session),
      externalId: session.id,
      paymentIntentId: paymentIntentIdOf(session),
    });
  } catch (err) {
    logger.error(
      { err, orderNumber, sessionId: session.id },
      "Failed to record a charge in the payment ledger; the payment itself is recorded",
    );
  }
}

/**
 * Record an issued Stripe refund as a negative movement.
 *
 * Keyed on the refund's own id rather than the payment intent's, so a return
 * refunded in two parts (a restocking-fee partial, later topped up to full)
 * lands as two rows and the ledger still sums to what the customer actually got
 * back — which the single `Refunded Amount` number on the Notion order cannot
 * show.
 */
export async function recordStripeRefund(input: {
  orderNumber: string;
  orderKind: PaymentOrderKind;
  stage?: string;
  refund: Stripe.Refund;
}): Promise<void> {
  if (!postgresConfigured()) return;
  const { orderNumber, orderKind, stage, refund } = input;
  if (!orderNumber.trim()) return;

  const intent = refund.payment_intent;
  try {
    await recordPaymentEntry({
      orderNumber,
      orderKind,
      ...(stage ? { stage } : {}),
      kind: "refund",
      amountCents: refund.amount ?? 0,
      currency: refund.currency ?? "usd",
      method: "stripe",
      paidAt: fromUnix(refund.created),
      externalId: refund.id,
      paymentIntentId: typeof intent === "string" ? intent : (intent?.id ?? ""),
    });
  } catch (err) {
    logger.error(
      { err, orderNumber, refundId: refund.id },
      "Failed to record a refund in the payment ledger; the refund itself was issued",
    );
  }
}
