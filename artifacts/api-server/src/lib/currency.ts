// What currency this studio trades in.
//
// One declaration, because "usd" was previously stated in four separate places
// (`checkout.service`, `invoice.service`, `lib/stripe/promotions`, and as the
// default on three Postgres repositories) with nothing tying them together. A
// constant nobody can disagree with is worth more than four that happen to
// match.
//
// WHY THIS EXISTS AT ALL, given the studio sells only in dollars. The money
// TABLES are currency-aware — `payments`, `issued_invoices` and `credit_notes`
// each store a currency, and `recordStripeCharge` faithfully records whatever
// Stripe says the session was in. The AGGREGATIONS were not: they summed every
// row regardless. Nothing can produce a non-USD row today (both checkout paths
// pin the currency), so that was a trap rather than a bug — but it is the kind
// that fails silently, by adding euros to dollars in a revenue figure, and the
// roadmap's "multi-currency & international shipping" card would arm it.
//
// So this is not a multi-currency implementation and must not be mistaken for
// one. It is the assumption those aggregations were already making, written
// down where it can be checked. Real multi-currency needs presentment
// currencies at checkout, per-currency Stripe shipping rates, duties, and a
// reporting-currency conversion with rates and their dates — none of which this
// constant provides.
//
// Deliberately NOT a Studio Setting: it is coupled to the Stripe account's
// configuration, its shipping rates and Stripe Tax, so changing it is a
// deployment decision rather than a business tunable — the same reason the email
// SENDERS stay env-only while the inboxes don't.

/** The currency every price, charge, refund and figure in the app is in.
 * Lowercase, as Stripe's API expects it. */
export const STUDIO_CURRENCY = "usd";

/**
 * Whether a stored or Stripe-supplied currency is the one the studio reports in.
 *
 * Case-insensitive: Stripe answers lowercase, but a hand-written row or a
 * backfill could carry "USD". An absent currency counts as the studio's — every
 * row predating the columns was in it, and treating unknown as foreign would
 * drop real money out of the figures.
 */
export function isStudioCurrency(currency: string | null | undefined): boolean {
  if (!currency) return true;
  return currency.toLowerCase() === STUDIO_CURRENCY;
}
