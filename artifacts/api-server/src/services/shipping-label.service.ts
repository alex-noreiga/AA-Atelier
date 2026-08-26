// Buying a shipping label for a shop order, from the studio dashboard.
//
// The roadmap card is "wire a label vendor so the atelier buys a label from the
// order and the `Carrier`, `Tracking Number` and `Tracking URL` fields fill
// themselves" — those three columns were the last thing on a shop order still
// copied by hand, from a second website, into a third. Everything downstream
// already reads them: `lib/fulfilment.ts` turns them into the customer's
// tracking panel, and does so identically for both order kinds. So this feature
// adds a WRITER to a pipeline that was already finished, which is why nothing
// customer-facing changed to ship it.
//
// It is two operations, not one, and that is the central decision. A label has a
// carrier and a service level and a price, and the difference between them is
// three days and eleven dollars — a one-press "buy the cheapest" would put a
// ground label on a dress needed Saturday. So the atelier asks for rates, reads
// them, and buys one. Money moves only in the second call.
//
// The other decisions worth keeping:
//
//  1. **The ship-to address comes from STRIPE, never from Notion.** The order
//     carries a `Shipping Address`, but as one display line assembled for a
//     human; parsing it back into components is guesswork, and a guessed address
//     is a parcel that doesn't arrive. Stripe collected the address in its parts
//     at checkout and still holds them, and the order stores its session id — so
//     the structured address is one retrieve away. Same instinct as "Stripe is
//     the source of truth for money".
//  2. **The order is the idempotency guard, because the vendor isn't.** Shippo
//     will sell a second label for the same parcel as happily as the first, and
//     unlike a Stripe refund there is nothing to read back that says "you have
//     already done this". An order that already carries a tracking number is
//     refused, and replacing one is an explicit act (`replace`), confirmed in
//     the dashboard — the same shape as the status email's `force`.
//  3. **The purchase outranks its bookkeeping.** If Notion won't take the
//     tracking number, the label is still bought and the studio has still paid
//     for it. Throwing there would lose the number entirely, so the failure is
//     reported with the number and the label URL in hand, and the dashboard says
//     to paste it. This is the opposite call from `recordShopOrderRefund`, and
//     the difference is which system holds the truth: there it's Stripe, here
//     it's the Notion write itself.

import type Stripe from "stripe";

import { getStripeClient } from "../lib/stripe/client.js";
import {
  fetchShippingRates,
  purchaseLabel,
  type ShippingRate,
} from "../lib/shippo/labels.repository.js";
import { shippoConfigured, shippoTestMode } from "../lib/shippo/client.js";
import {
  shipFromAddress,
  shipFromProblems,
} from "../lib/shipping/from-address.js";
import {
  addressProblems,
  formatAddressLines,
  toPostalAddress,
  type PostalAddress,
} from "../lib/shipping/address.js";
import {
  PARCEL_PRESETS,
  findParcelPreset,
  weightProblem,
} from "../lib/shipping/parcels.js";
import {
  findShopOrderForShipping,
  recordShopOrderTracking,
  type ShopOrderShippingTarget,
} from "../lib/notion/shop-orders.repository.js";
import { looksLikePickup } from "../lib/fulfilment.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../lib/errors.js";
import { logger } from "../lib/logger.js";

/** What the dashboard needs to render the panel before anything is asked for. */
export interface ShippingOptionsView {
  configured: boolean;
  /** True when the vendor token is a test one — labels look real and aren't. */
  testMode: boolean;
  /** The studio's ship-from address as envelope lines, when it's usable. */
  shipFrom?: string[];
  /** Everything standing between the atelier and a label: an unset token, an
   * incomplete ship-from address. Empty ⇒ the panel is ready to use. */
  problems: string[];
  parcels: Array<{
    id: string;
    name: string;
    hint: string;
    length: number;
    width: number;
    height: number;
  }>;
}

/** The rates for one parcel, with what they'd be posted to. */
export interface ShippingRatesView {
  orderNumber: string;
  /** The customer's address, as envelope lines — so a wrong one is caught by
   * eye before it is paid for rather than after it is posted. */
  shipTo: string[];
  rates: ShippingRate[];
  /** The carrier's own words when it declined to quote. Empty is normal. */
  notes: string[];
}

/** A bought label, and whether the order actually recorded it. */
export interface PurchasedLabelView {
  orderNumber: string;
  carrier: string;
  service: string;
  amount: number;
  currency: string;
  trackingNumber: string;
  trackingUrl?: string;
  labelUrl?: string;
  /** False ⇒ the label is bought but Notion refused the write. The atelier has
   * to paste the number onto the order themselves; the panel says so. */
  recorded: boolean;
  testMode: boolean;
}

/** What a rate request carries. */
export interface RateRequest {
  orderNumber: string;
  parcelId: string;
  weightOz: number;
}

/** What a purchase carries. */
export interface LabelRequest {
  orderNumber: string;
  rateId: string;
  /** Buy a second label for an order that already has tracking on it. */
  replace?: boolean;
}

/**
 * What the panel can do right now, and what's stopping it.
 *
 * Reports rather than throws, all the way down: an unset token and a half-filled
 * ship-from address are both states only a human can clear, and a panel that
 * 500s on load can't tell anyone which one it is. Same shape as the materials
 * panel's unreachable database and the settings editor's unconfigured one.
 */
export function getShippingOptions(): ShippingOptionsView {
  const configured = shippoConfigured();
  const from = shipFromAddress();
  const fromProblems = shipFromProblems(from);

  const problems: string[] = [];
  if (!configured) {
    problems.push(
      "No shipping vendor is connected. Set SHIPPO_API_KEY to buy labels here.",
    );
  }
  problems.push(...fromProblems);

  return {
    configured,
    testMode: shippoTestMode(),
    ...(fromProblems.length === 0
      ? { shipFrom: formatAddressLines(from) }
      : {}),
    problems,
    parcels: PARCEL_PRESETS.map((preset) => ({ ...preset })),
  };
}

/** Refuse early and by name when the studio can't post anything at all. A rate
 * request that reached the vendor with a blank origin would come back as an
 * opaque carrier rejection, which is a much worse way to learn the same thing. */
function assertReadyToShip(): void {
  if (!shippoConfigured()) {
    throw new ConflictError(
      "No shipping vendor is connected, so labels can't be bought here yet.",
    );
  }
  const problems = shipFromProblems();
  if (problems.length > 0) {
    throw new ConflictError(problems.join(" "));
  }
}

/**
 * The order a label is for, once it's established that one can be bought for it.
 *
 * Four refusals, each of which would otherwise be money spent on a label nobody
 * can use: an order that doesn't exist, one that was cancelled, one the customer
 * is collecting in person, and one that was never paid through the app (a
 * hand-filed Etsy or skate-shop row, which has no Stripe session and therefore
 * no address in its parts — the honest answer there is that the atelier buys
 * that label wherever they took the order).
 */
async function resolveOrder(
  orderNumber: string,
): Promise<ShopOrderShippingTarget> {
  const trimmed = orderNumber.trim();
  if (!trimmed) {
    throw new BadRequestError("Enter a shop order number.");
  }
  if (!/^SHP-/i.test(trimmed)) {
    throw new BadRequestError(
      "Labels are bought for shop orders, whose numbers start with SHP-. A custom order's parcel is posted by hand.",
    );
  }

  const order = await findShopOrderForShipping(trimmed);
  if (!order) {
    throw new NotFoundError("We couldn't find a shop order with that number.");
  }
  if (order.cancelled) {
    throw new ConflictError(
      `Order ${order.orderNumber} is cancelled, so there's nothing to post.`,
    );
  }
  if (looksLikePickup(order.deliveryMethod)) {
    throw new ConflictError(
      `Order ${order.orderNumber} is being collected in person, so it needs no label.`,
    );
  }
  if (!order.sessionId) {
    throw new ConflictError(
      `Order ${order.orderNumber} wasn't paid through the website, so we have no address on file for it. Buy this label wherever the order was taken.`,
    );
  }

  return order;
}

/**
 * The customer's address in its parts, read back off the Stripe checkout.
 *
 * Stripe moved this between API versions (`shipping_details` →
 * `collected_information.shipping_details`), so it's read defensively in the
 * same order `formatShippingAddress` reads it — one vocabulary, so the line
 * printed on the Notion order and the address printed on the label can't come
 * from different places. The billing address is the last resort rather than an
 * equal: for a shop cart Stripe collects shipping, and falling through to
 * billing covers the order where it didn't.
 */
export function shipToFromSession(
  session: Stripe.Checkout.Session,
): PostalAddress {
  const loose = session as unknown as {
    collected_information?: {
      shipping_details?: {
        name?: string | null;
        phone?: string | null;
        address?: Record<string, string | null | undefined>;
      };
    };
    shipping_details?: {
      name?: string | null;
      phone?: string | null;
      address?: Record<string, string | null | undefined>;
    };
  };

  const shipping =
    loose.collected_information?.shipping_details ??
    loose.shipping_details ??
    null;
  const address = shipping?.address ?? session.customer_details?.address ?? {};

  return toPostalAddress({
    name: shipping?.name ?? session.customer_details?.name ?? null,
    street1: address.line1 ?? null,
    street2: address.line2 ?? null,
    city: address.city ?? null,
    state: address.state ?? null,
    zip: address.postal_code ?? null,
    country: address.country ?? null,
    phone: shipping?.phone ?? session.customer_details?.phone ?? null,
    email: session.customer_details?.email ?? null,
  });
}

/** Fetch the checkout and turn it into an address, or say which it was that
 * failed — a session Stripe no longer has and a session with half an address on
 * it are different problems with different fixes. */
async function shipToForOrder(
  order: ShopOrderShippingTarget,
  stripe: Stripe = getStripeClient(),
): Promise<PostalAddress> {
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(order.sessionId);
  } catch (err) {
    logger.error(
      { err, orderNumber: order.orderNumber, sessionId: order.sessionId },
      "Could not read the checkout session for a shipping label",
    );
    throw new ConflictError(
      `We couldn't read the checkout for order ${order.orderNumber}, so there's no address to post to.`,
    );
  }

  const shipTo = shipToFromSession(session);
  const problems = addressProblems(
    shipTo,
    `The address on order ${order.orderNumber}`,
  );
  if (problems.length > 0) {
    throw new ConflictError(
      `${problems.join(" ")} Buy this label through the carrier directly.`,
    );
  }
  return shipTo;
}

/**
 * Rate one parcel for one order. Reads and quotes; buys nothing.
 *
 * Deliberately does NOT refuse an order that already has tracking on it — asking
 * what a second label would cost is a reasonable thing to want to know, and the
 * refusal belongs at the point money moves, not at the point of asking.
 */
export async function getShippingRates(
  request: RateRequest,
): Promise<ShippingRatesView> {
  assertReadyToShip();

  const preset = findParcelPreset(request.parcelId);
  if (!preset) {
    throw new BadRequestError("Choose one of the studio's packaging sizes.");
  }
  const badWeight = weightProblem(request.weightOz);
  if (badWeight) throw new BadRequestError(badWeight);

  const order = await resolveOrder(request.orderNumber);
  const shipTo = await shipToForOrder(order);

  const { rates, messages } = await fetchShippingRates(
    shipFromAddress(),
    shipTo,
    {
      length: preset.length,
      width: preset.width,
      height: preset.height,
      weightOz: request.weightOz,
    },
  );

  logger.info(
    {
      orderNumber: order.orderNumber,
      parcel: preset.id,
      weightOz: request.weightOz,
      rates: rates.length,
    },
    "Fetched shipping rates",
  );

  return {
    orderNumber: order.orderNumber,
    shipTo: formatAddressLines(shipTo),
    rates,
    notes: messages,
  };
}

/**
 * Buy the chosen rate as a label and write its tracking onto the order.
 *
 * The order is re-resolved rather than trusted from the rate step: the two calls
 * are separated by however long the atelier spent reading the list, and an order
 * cancelled in between is one this must not post.
 */
export async function buyShippingLabel(
  request: LabelRequest,
): Promise<PurchasedLabelView> {
  assertReadyToShip();

  const rateId = request.rateId?.trim();
  if (!rateId) {
    throw new BadRequestError("Choose a rate to buy.");
  }

  const order = await resolveOrder(request.orderNumber);

  if (order.trackingNumber && request.replace !== true) {
    throw new ConflictError(
      `Order ${order.orderNumber} already has tracking number ${order.trackingNumber}${
        order.carrier ? ` (${order.carrier})` : ""
      }. Tick “buy another label” if the first one was voided and you need a replacement.`,
    );
  }

  const label = await purchaseLabel(rateId);

  const recorded = await recordShopOrderTracking(order.pageId, {
    number: label.trackingNumber,
    ...(label.carrier ? { carrier: label.carrier } : {}),
    ...(label.trackingUrl ? { url: label.trackingUrl } : {}),
  });

  logger.info(
    {
      orderNumber: order.orderNumber,
      transactionId: label.transactionId,
      carrier: label.carrier,
      amount: label.amount,
      recorded,
      replaced: order.trackingNumber ? true : undefined,
    },
    "Bought a shipping label",
  );

  return {
    orderNumber: order.orderNumber,
    carrier: label.carrier,
    service: label.service,
    amount: label.amount,
    currency: label.currency,
    trackingNumber: label.trackingNumber,
    ...(label.trackingUrl ? { trackingUrl: label.trackingUrl } : {}),
    ...(label.labelUrl ? { labelUrl: label.labelUrl } : {}),
    recorded,
    testMode: shippoTestMode(),
  };
}
