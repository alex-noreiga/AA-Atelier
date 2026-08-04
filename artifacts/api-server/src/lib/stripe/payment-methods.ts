// Optional buy-now-pay-later (BNPL / installment financing) payment methods
// offered at checkout, controlled by a comma-separated `STRIPE_BNPL_METHODS`
// env var — the same "list the Stripe things you want in env" pattern as
// `STRIPE_SHIPPING_RATE_IDS`.
//
// Stripe settles these by paying the studio IN FULL up front and carrying the
// installment risk itself, so "the studio is paid in full up front" is inherent
// to how the method clears — there's nothing extra to reconcile on our side.
//
// Degrade-safe: when the env var is UNSET this returns undefined and the caller
// OMITS `payment_method_types` entirely, so Checkout keeps Stripe's dynamic
// payment methods (whatever is enabled in the Dashboard) exactly as before. When
// it's SET, the caller pins `payment_method_types` to card + the requested BNPL
// methods, giving the atelier a deterministic, in-repo record of what appears.

import type Stripe from "stripe";
import { logger } from "../logger.js";

type PaymentMethodType = Stripe.Checkout.SessionCreateParams.PaymentMethodType;

// The BNPL methods this app supports offering. Each is a Stripe payment-method
// type id that must ALSO be enabled in the Stripe Dashboard, and is subject to
// Stripe's own eligibility rules — currency, customer country, and per-method
// amount thresholds (e.g. Affirm has a minimum) — which silently hide an
// ineligible method at checkout, so no amount-gating is needed here.
const SUPPORTED_BNPL: readonly PaymentMethodType[] = [
  "klarna",
  "affirm",
  "afterpay_clearpay", // Afterpay (US) / Clearpay (UK) share one type id
];

/**
 * Parse `STRIPE_BNPL_METHODS` into a validated Checkout `payment_method_types`
 * list, or undefined when no BNPL is configured (⇒ the caller omits the field ⇒
 * dynamic payment methods, unchanged). Unknown/misspelled ids are dropped and
 * logged at `error` (mirroring the shipping-rate resolver) rather than 400-ing
 * the checkout, and if nothing valid remains it degrades to undefined so a
 * typo can never produce a card-less checkout.
 *
 * "card" is always prepended: setting `payment_method_types` overrides dynamic
 * payment methods, so card must be listed explicitly or it wouldn't be offered.
 */
export function bnplPaymentMethodTypes(): PaymentMethodType[] | undefined {
  const requested = (process.env.STRIPE_BNPL_METHODS ?? "")
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter((m) => m.length > 0);
  if (requested.length === 0) return undefined;

  const methods = new Set<PaymentMethodType>();
  for (const method of requested) {
    if ((SUPPORTED_BNPL as readonly string[]).includes(method)) {
      methods.add(method as PaymentMethodType);
    } else {
      logger.error(
        { method, supported: SUPPORTED_BNPL },
        "Ignoring unsupported STRIPE_BNPL_METHODS entry. Use a comma-separated " +
          "list of: klarna, affirm, afterpay_clearpay.",
      );
    }
  }

  if (methods.size === 0) return undefined;
  // Card first so it stays the primary/default option on the hosted page.
  return ["card", ...methods];
}
