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
import { BadRequestError } from "../lib/errors.js";

const CURRENCY = "usd";
// v1 default — the atelier can widen this to the markets it ships to.
const SHIPPING_COUNTRIES: Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[] =
  ["US", "CA"];

function siteBaseUrl(): string {
  const base = process.env.PUBLIC_BASE_URL;
  if (!base) {
    throw new Error("PUBLIC_BASE_URL environment variable is not set");
  }
  return base.replace(/\/+$/, "");
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
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: lineItems,
    shipping_address_collection: { allowed_countries: SHIPPING_COUNTRIES },
    success_url: `${base}/shop/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/shop`,
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }
  return { url: session.url };
}

export async function getCheckoutSession(
  sessionId: string,
  stripe: Stripe = getStripeClient(),
): Promise<{ status: string; email?: string }> {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const email = session.customer_details?.email ?? undefined;
  return {
    status: session.payment_status,
    ...(email ? { email } : {}),
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
