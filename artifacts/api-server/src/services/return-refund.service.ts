// The atelier-facing half of a return / exchange: issue the Stripe refund for a
// shop order the customer asked to return, and record it on the order. The
// customer files the request (`return-request.service`, Approach A); the atelier
// reviews it and presses the button here — the same split as order cancellation.
//
// WHY THIS ISN'T JUST `processCancellation` WITH AN AMOUNT
// -------------------------------------------------------
// A cancellation is always "give it all back, once", so it can use the simple
// guard "any refund already exists ⇒ skip". A return can't: a restocking fee is
// a deliberate PARTIAL refund, an even exchange refunds nothing at all, and the
// atelier may top a partial refund up to full later. Under the cancellation
// guard, the first partial refund would permanently block the top-up; under a
// naive "refund this increment" model, a re-pressed link would refund twice.
//
// So the amount is DECLARATIVE, not incremental:
//
//     ?amount=X  means  "the total refunded on this order should be $X"
//
// and the service issues `max(0, X − what Stripe says is already refunded)`.
// That single choice buys every property that matters here:
//
//   - Idempotent for as long as the order exists. Re-pressing the same link
//     refunds $0 the second time, because the target is already met. (A Stripe
//     idempotency key can't do this job on its own — those expire after 24h,
//     and the atelier may well click the same Notion link a week later.)
//   - Can never over-refund. The delta is computed against Stripe's own refund
//     total (which includes refunds issued by hand in the Dashboard) and the
//     target is clamped to the amount actually captured.
//   - Covers all three return shapes with one parameter: full refund (omit
//     `amount`), restocking fee ($200 order → `amount=180`), and even exchange
//     (`amount=0`, which refunds nothing but still marks the return processed).
//
// Money is read from Stripe and only from Stripe. The Notion markers this
// writes are atelier visibility, and their write is best-effort — see
// `recordShopOrderRefund`.

import type Stripe from "stripe";
import { getStripeClient } from "../lib/stripe/client.js";
import {
  paymentIntentIdOf,
  capturedCents,
  refundedCents,
  toCents,
  toDollars,
} from "../lib/stripe/refunds.js";
import {
  findShopOrderForCancellation,
  recordShopOrderRefund,
} from "../lib/notion/shop-orders.repository.js";
import { NotFoundError, BadRequestError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { returnRefundEmail } from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress } from "../lib/resend/config.js";

/** What happened to the order's payment this run. */
export type ReturnRefundStatus =
  /** A refund was issued this run (`refunded` > 0). */
  | "refunded"
  /** Stripe is already at or above the requested total — nothing owed. */
  | "already_at_target"
  /** Nothing to refund: a $0/fully-promo session, or no session recorded. */
  | "no_payment"
  /** The Stripe call failed; nothing was refunded and nothing was marked. */
  | "error";

/** The outcome of processing a return refund, for the JSON / HTML confirmation. */
export interface ReturnRefundResult {
  orderNumber: string;
  status: ReturnRefundStatus;
  /** Dollars refunded by THIS run (0 unless status === "refunded"). */
  refunded: number;
  /** Dollars refunded on this order in total, after this run. */
  totalRefunded: number;
  /** Dollars actually captured on the order — the ceiling for any refund. */
  captured: number;
  /** True when the run left the order fully refunded. */
  fullyRefunded: boolean;
  /** True when the Notion markers couldn't be written (refund still stands). */
  markerFailed: boolean;
  /** Human note for anything the atelier should know (skips, errors, clamps). */
  notes: string[];
}

/**
 * Parse the atelier-supplied `?amount=` (dollars) into cents.
 *
 * Returns `undefined` when the param is absent — meaning "refund it all", which
 * is deliberately distinct from `0` ("refund nothing", an even exchange). A
 * malformed or negative value is rejected rather than coerced, because silently
 * reading a typo'd amount as 0 (or as everything) moves real money.
 */
export function parseRefundTarget(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;

  const dollars = Number(raw.trim());
  if (!Number.isFinite(dollars) || dollars < 0) {
    throw new BadRequestError(
      `Invalid refund amount "${raw}" — pass a non-negative dollar figure, or omit it to refund the order in full.`,
    );
  }
  return toCents(dollars);
}

/**
 * Refund shop order `orderNumber` up to a target total.
 *
 * @param targetCents The total that should end up refunded, in cents. Omitted
 *   ⇒ the full captured amount. Clamped to what was actually captured.
 */
export async function processReturnRefund(
  orderNumber: string,
  targetCents?: number,
  stripe: Stripe = getStripeClient(),
): Promise<ReturnRefundResult> {
  const trimmed = orderNumber.trim();
  if (!trimmed) {
    throw new NotFoundError("We couldn't find a shop order with that number.");
  }

  const order = await findShopOrderForCancellation(trimmed);
  if (!order) {
    throw new NotFoundError("We couldn't find a shop order with that number.");
  }

  const notes: string[] = [];
  const base = {
    orderNumber: order.orderNumber,
    refunded: 0,
    captured: 0,
    fullyRefunded: false,
    markerFailed: false,
  };

  // A shop order paid outside Stripe (or a legacy row) has no session to refund.
  if (!order.sessionId.trim()) {
    return {
      ...base,
      status: "no_payment",
      totalRefunded: order.refundedAmount,
      notes: ["no Stripe session recorded on this order — refund manually"],
    };
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(order.sessionId);
    const paymentIntent = paymentIntentIdOf(session);

    // A $0 / fully-promo checkout never captured anything.
    if (!paymentIntent) {
      return {
        ...base,
        status: "no_payment",
        totalRefunded: 0,
        notes: ["no payment was captured on this order — nothing to refund"],
      };
    }

    const captured = await capturedCents(stripe, paymentIntent);
    const alreadyRefunded = await refundedCents(stripe, paymentIntent);

    // Clamp the target to what was actually captured, so a fat-fingered amount
    // (or a full-refund request against a partly-refunded order) can't ask
    // Stripe for more than exists.
    const requested = targetCents ?? captured;
    const target = Math.min(requested, captured);
    if (requested > captured) {
      notes.push(
        `requested $${toDollars(requested).toFixed(2)} exceeds the $${toDollars(captured).toFixed(2)} captured — capped at the captured amount`,
      );
    }

    const delta = target - alreadyRefunded;

    if (delta <= 0) {
      // Already at (or past) the target: an even exchange, a re-press, or a
      // refund the atelier already issued by hand. Still mark it processed.
      const marked = await recordShopOrderRefund(
        order.pageId,
        toDollars(alreadyRefunded),
      );
      if (alreadyRefunded > 0) {
        notes.push(
          `$${toDollars(alreadyRefunded).toFixed(2)} was already refunded — no further refund was needed`,
        );
      } else {
        notes.push("no refund was requested for this return");
      }
      return {
        ...base,
        status: "already_at_target",
        captured: toDollars(captured),
        totalRefunded: toDollars(alreadyRefunded),
        fullyRefunded: captured > 0 && alreadyRefunded >= captured,
        markerFailed: !marked,
        notes,
      };
    }

    // The idempotency key is keyed on the TARGET, not the delta, so a double
    // click within Stripe's 24h window collapses to one refund while a genuine
    // later top-up to a higher target is still allowed through.
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntent, amount: delta },
      { idempotencyKey: `return_${paymentIntent}_${target}` },
    );

    const refundedNow = refund.amount ?? delta;
    const totalCents = alreadyRefunded + refundedNow;
    const marked = await recordShopOrderRefund(
      order.pageId,
      toDollars(totalCents),
    );
    if (!marked) {
      notes.push(
        "the refund succeeded, but the Refunded Amount / Return Processed fields could not be written to Notion",
      );
    }

    // Best-effort customer email, only when money actually moved.
    if (order.email.trim()) {
      await sendEmailBestEffort({
        ...returnRefundEmail(
          order.email,
          order.orderNumber,
          toDollars(refundedNow),
        ),
        from: fromAddress("orders"),
      });
    }

    return {
      orderNumber: order.orderNumber,
      status: "refunded",
      refunded: toDollars(refundedNow),
      totalRefunded: toDollars(totalCents),
      captured: toDollars(captured),
      fullyRefunded: totalCents >= captured,
      markerFailed: !marked,
      notes,
    };
  } catch (err) {
    // A mode-mismatched/deleted session or a Stripe hiccup — surface it for the
    // atelier to reconcile and re-press, rather than 500-ing the whole run. The
    // re-press is safe: the target model recomputes from Stripe every time.
    logger.error(
      { err, orderNumber: order.orderNumber },
      "Failed to process return refund",
    );
    return {
      ...base,
      status: "error",
      totalRefunded: order.refundedAmount,
      notes: [
        `refund failed (${err instanceof Error ? err.message : String(err)})`,
      ],
    };
  }
}
