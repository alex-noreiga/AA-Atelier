// Shop-checkout use-cases, independent of HTTP.
//
// The cardinal rule: the client sends only { variantId, size?, quantity } — it
// never sends prices. Prices, availability, and totals are ALWAYS recomputed
// here from live Notion inventory, so a tampered or stale cart can't set its own
// price or buy something that's sold out. Unpurchasable items raise a
// BadRequestError (-> 400) with a customer-safe message.

import type Stripe from "stripe";
import type { CheckoutItem } from "@workspace/api-zod";
import { listVariants } from "../lib/notion/products.repository.js";
import type { VariantRecord } from "../lib/notion/products.schema.js";
import {
  createShopOrder,
  findOrderBySessionId,
} from "../lib/notion/shop-orders.repository.js";
import { getStripeClient } from "../lib/stripe/client.js";
import { siteBaseUrl } from "../lib/site.js";
import { BadRequestError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

const CURRENCY = "usd";
// v1 default — the atelier can widen this to the markets it ships to.
const SHIPPING_COUNTRIES: Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[] =
  ["US", "CA"];

/**
 * The Stripe Shipping Rate ids to offer at checkout, from a comma-separated
 * `STRIPE_SHIPPING_RATE_IDS` (e.g. "shr_standard,shr_express"). The atelier
 * creates and prices these in the Stripe Dashboard, so amounts change with no
 * redeploy. When unset, checkout charges no shipping.
 */
function shippingRateIds(): string[] {
  return (process.env.STRIPE_SHIPPING_RATE_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * Turn the configured shipping-rate ids into Stripe `shipping_options`, dropping
 * any id Stripe won't accept instead of letting one bad id 500 the whole
 * checkout. Each id is retrieved and kept only if it exists, is active, and is
 * priced in USD (a foreign-currency rate is silently dropped by Stripe at
 * session create anyway). A dropped id — deleted/archived in the Dashboard, or a
 * mode mismatch (a test `shr_…` under a live key, or vice-versa) — is logged at
 * `error` so a misconfiguration is loud and actionable rather than a hard outage.
 *
 * If every configured id is invalid the customer sees no shipping option (i.e.
 * $0 shipping) — degraded, but the shop still takes orders — and the logs say why.
 */
async function resolveShippingOptions(
  stripe: Stripe,
): Promise<Stripe.Checkout.SessionCreateParams.ShippingOption[]> {
  const ids = shippingRateIds();
  if (ids.length === 0) return [];

  const options: Stripe.Checkout.SessionCreateParams.ShippingOption[] = [];
  for (const id of ids) {
    try {
      const rate = await stripe.shippingRates.retrieve(id);
      if (!rate.active) {
        logger.error(
          { shippingRateId: id },
          "Skipping shipping rate: it is archived (inactive) in Stripe. " +
            "Re-activate it or update STRIPE_SHIPPING_RATE_IDS, then redeploy.",
        );
        continue;
      }
      const currency = rate.fixed_amount?.currency;
      if (currency !== CURRENCY) {
        logger.error(
          { shippingRateId: id, currency, expected: CURRENCY },
          "Skipping shipping rate: its currency does not match the checkout " +
            "currency (USD), so Stripe would drop it. Recreate the rate in USD.",
        );
        continue;
      }
      options.push({ shipping_rate: id });
    } catch (err) {
      logger.error(
        { err, shippingRateId: id },
        "Skipping shipping rate: Stripe could not resolve it. It was likely " +
          "deleted, or belongs to a different Stripe mode than STRIPE_SECRET_KEY " +
          "(a test rate under a live key, or vice-versa). Fix " +
          "STRIPE_SHIPPING_RATE_IDS in the environment and redeploy.",
      );
    }
  }

  if (options.length === 0) {
    logger.error(
      { configured: ids },
      "No configured shipping rate is usable — checkout will charge $0 shipping. " +
        "Every id in STRIPE_SHIPPING_RATE_IDS is missing, inactive, or non-USD.",
    );
  }
  return options;
}

/**
 * Resolve one requested cart item against live inventory and turn it into a
 * Stripe line item, or throw a BadRequestError explaining why it can't be sold.
 */
function toLineItem(
  item: CheckoutItem,
  variantsById: Map<string, VariantRecord>,
): Stripe.Checkout.SessionCreateParams.LineItem {
  const variant = variantsById.get(item.variantId);
  if (!variant) {
    throw new BadRequestError("One of your items is no longer available.");
  }
  if (!variant.available) {
    throw new BadRequestError(`"${variant.name}" is sold out.`);
  }
  if (typeof variant.price !== "number") {
    throw new BadRequestError(
      `"${variant.name}" isn't available for online purchase — please inquire.`,
    );
  }

  // Sized items must name an in-stock size; one-size items ignore `size`.
  if (variant.sizes.length > 0) {
    const size = variant.sizes.find((s) => s.name === item.size);
    if (!size) {
      throw new BadRequestError(`Please choose a size for "${variant.name}".`);
    }
    if (!size.available) {
      throw new BadRequestError(
        `"${variant.name}" in ${size.name} is sold out.`,
      );
    }
  }

  const name = item.size ? `${variant.name} — ${item.size}` : variant.name;

  return {
    quantity: item.quantity,
    price_data: {
      currency: CURRENCY,
      unit_amount: Math.round(variant.price * 100),
      // Listed prices are pre-tax; Stripe Tax adds tax on top ("exclusive").
      tax_behavior: "exclusive",
      product_data: { name },
    },
  };
}

export async function createCheckoutSession(
  items: CheckoutItem[],
  stripe: Stripe = getStripeClient(),
): Promise<{ url: string }> {
  if (items.length === 0) {
    throw new BadRequestError("Your cart is empty.");
  }

  const variants = await listVariants();
  const variantsById = new Map(variants.map((v) => [v.id, v]));
  const lineItems = items.map((item) => toLineItem(item, variantsById));

  const base = siteBaseUrl();
  const shippingOptions = await resolveShippingOptions(stripe);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: lineItems,
    // Stripe Tax computes sales tax from the collected address (configure the
    // origin + default tax category in the Stripe Dashboard). Deposits stay
    // untaxed — tax is assessed on the final balance, not the deposit — so this
    // is deliberately only on the shop cart, not deposit.service.
    automatic_tax: { enabled: true },
    shipping_address_collection: { allowed_countries: SHIPPING_COUNTRIES },
    // Attach the atelier's Stripe-managed shipping rate(s) for the customer to
    // pick from; omit the field entirely when none resolve (Stripe rejects an
    // empty array), which charges no shipping. Invalid ids are dropped and
    // logged in resolveShippingOptions rather than failing the whole checkout.
    ...(shippingOptions.length > 0
      ? { shipping_options: shippingOptions }
      : {}),
    success_url: `${base}/shop/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/shop`,
    // Lets the webhook route this session to shop-order recording rather than
    // to a deposit payment (see routes/stripe-webhook.ts).
    metadata: { kind: "shop" },
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }
  return { url: session.url };
}

interface ReceiptLine {
  description: string;
  quantity: number;
  amount: number;
}

export interface CheckoutSessionView {
  status: string;
  email?: string;
  currency?: string;
  lineItems?: ReceiptLine[];
  amountSubtotal?: number;
  amountShipping?: number;
  amountTax?: number;
  amountTotal?: number;
}

/** Stripe amounts are integer minor units (cents); the receipt shows dollars. */
function toDollars(amountInCents: number | null | undefined): number {
  return typeof amountInCents === "number" ? amountInCents / 100 : 0;
}

export async function getCheckoutSession(
  sessionId: string,
  stripe: Stripe = getStripeClient(),
): Promise<CheckoutSessionView> {
  // Expand line items so the success page can render an itemized receipt.
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["line_items"],
  });
  const email = session.customer_details?.email ?? undefined;
  const lineItems = (session.line_items?.data ?? []).map((item) => ({
    description: item.description ?? "Item",
    quantity: item.quantity ?? 1,
    amount: toDollars(item.amount_total),
  }));

  return {
    status: session.payment_status,
    ...(email ? { email } : {}),
    ...(session.currency ? { currency: session.currency } : {}),
    ...(lineItems.length > 0 ? { lineItems } : {}),
    amountSubtotal: toDollars(session.amount_subtotal),
    amountShipping: toDollars(session.total_details?.amount_shipping),
    amountTax: toDollars(session.total_details?.amount_tax),
    amountTotal: toDollars(session.amount_total),
  };
}

/**
 * Record a completed checkout as a Notion "Shop Orders" page. Called from the
 * Stripe webhook. Idempotent (dedupes on the session id) so Stripe's at-least-
 * once delivery / retries can't create duplicate orders. Only paid sessions are
 * recorded.
 */
export async function recordPaidOrder(
  session: Stripe.Checkout.Session,
  stripe: Stripe = getStripeClient(),
): Promise<void> {
  if (await findOrderBySessionId(session.id)) {
    return;
  }

  // The webhook's session object omits line items; retrieve them for the record.
  const full = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["line_items"],
  });

  if (full.payment_status !== "paid") {
    return;
  }

  await createShopOrder(full);
}
