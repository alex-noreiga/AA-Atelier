// Low-level Stripe refund primitives, shared by the atelier's money-moving
// flows (today: the return/exchange refund in `services/return-refund.service`).
//
// These read the *current* refund state from Stripe rather than from anything we
// store, which is the same rule the checkout path follows for prices: Stripe is
// the source of truth for money, so a marker we wrote (or failed to write) can
// never cause a double refund. Everything here is in integer CENTS — dollars are
// only for display and for the atelier-supplied `?amount=`.

import type Stripe from "stripe";

/** Resolve a Checkout session's payment intent id. Returns null for a $0 /
 * fully-promo session, which has no payment to refund. */
export function paymentIntentIdOf(
  session: Pick<Stripe.Checkout.Session, "payment_intent">,
): string | null {
  return typeof session.payment_intent === "string"
    ? session.payment_intent
    : (session.payment_intent?.id ?? null);
}

/**
 * The amount actually captured on a payment intent, in cents — the hard ceiling
 * for any refund. Read from the intent (not the session total) because a session
 * total can include a discount/promo that was never captured.
 */
export async function capturedCents(
  stripe: Stripe,
  paymentIntentId: string,
): Promise<number> {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  return intent.amount_received ?? 0;
}

/**
 * Sum every refund already issued against a payment intent, in cents —
 * including refunds the atelier issued by hand in the Stripe Dashboard, which is
 * exactly why we ask Stripe instead of trusting our own marker.
 *
 * `limit: 100` is not paginated: a single shop order accumulating more than 100
 * separate refunds is not a real case, and under-counting here could only ever
 * be caused by a state we'd want a human to look at anyway.
 */
export async function refundedCents(
  stripe: Stripe,
  paymentIntentId: string,
): Promise<number> {
  const refunds = await stripe.refunds.list({
    payment_intent: paymentIntentId,
    limit: 100,
  });
  return refunds.data.reduce((sum, refund) => sum + (refund.amount ?? 0), 0);
}

/** Dollars (as the atelier types them) → integer cents, the same
 * `Math.round(x * 100)` conversion `checkout.service` uses for prices. */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Integer cents → dollars, for display and for the summary/email. */
export function toDollars(cents: number): number {
  return Math.round(cents) / 100;
}
