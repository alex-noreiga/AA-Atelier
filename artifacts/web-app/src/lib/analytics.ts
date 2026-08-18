// Conversion & funnel analytics — custom events on top of Vercel Web Analytics.
//
// Pageviews are collected by <ConsentedAnalytics /> (components/analytics.tsx);
// this module adds the funnel events the studio can't see from pageviews alone:
// add-to-cart, begin-checkout, purchase, and order-form start / submit.
//
// Two rules hold this to the same privacy contract as the pageview tracking:
//
//   1. Consent-gated. `useAnalytics()` reads the cookie-consent status and emits
//      NOTHING until the visitor has opted in — the same opt-IN gate that
//      withholds Vercel's <Analytics /> script. On "unset"/"denied" every call
//      is a no-op, so a funnel event can never beat the banner.
//   2. No PII in properties. Vercel custom-event properties are flat scalars
//      only (string | number | boolean | null — no nested objects/arrays), and
//      we deliberately send only non-identifying facts (counts, amounts, flags,
//      variant ids) — never a name, email, phone, or measurement.

import { useCallback } from "react";
import { track } from "@vercel/analytics";
import { useOptionalConsent } from "@/lib/consent";

/**
 * Custom event names, as constants so a call site and a Vercel dashboard filter
 * can't silently drift on a typo.
 */
export const AnalyticsEvent = {
  /** A shop item (and any ticked add-ons) added to the cart. */
  AddToCart: "add_to_cart",
  /** The Checkout button pressed in the cart drawer. */
  BeginCheckout: "begin_checkout",
  /** A completed Stripe payment landed on the success page. */
  Purchase: "purchase",
  /** First interaction with the custom-order intake form. */
  OrderFormStart: "order_form_start",
  /** The custom-order intake form submitted (client-side, pre-network). */
  OrderFormSubmit: "order_form_submit",
} as const;

export type AnalyticsEventName =
  (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

/** Flat scalar properties only — Vercel custom events reject nested values. */
export type AnalyticsProps = Record<string, string | number | boolean | null>;

/**
 * Returns a `track(event, props?)` function that emits a custom funnel event
 * ONLY when analytics consent is granted; before consent (or on decline) it is
 * a no-op. Call sites live in React event handlers / effects, so reading the
 * consent status from context here is safe.
 */
export function useAnalytics() {
  // Non-throwing read: outside a ConsentProvider there is no consent, so we
  // emit nothing (also keeps components using this hook renderable in isolation).
  const consent = useOptionalConsent();
  const status = consent?.status;
  return useCallback(
    (event: AnalyticsEventName, props?: AnalyticsProps) => {
      if (status !== "granted") return;
      track(event, props);
    },
    [status],
  );
}
