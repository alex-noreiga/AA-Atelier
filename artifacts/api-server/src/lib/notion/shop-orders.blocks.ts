// Builds the Notion page representation of a paid shop order: the page
// `properties` and the `children` block array (one bullet per purchased line).
// Kept separate from the HTTP/Notion request layer so the Stripe-session ->
// Notion mapping is independently testable.
//
// Property *types* here must match the live "Shop Orders" schema, not the
// property name (same lesson as `blocks.ts` / `.agents/memory/`). The atelier
// must create this database with these properties and share the integration
// with it, or writes 404.

import type Stripe from "stripe";

import { normalizeEmail } from "../email.js";

// Live-schema property names (a Notion rename is a one-line change here).
export const SHOP_ORDER_TITLE_PROPERTY = "Order Name"; // title
export const SHOP_ORDER_NUMBER_PROPERTY = "Order Number"; // rich_text
export const SHOP_ORDER_SESSION_PROPERTY = "Stripe Session Id"; // rich_text
export const SHOP_ORDER_EMAIL_PROPERTY = "Customer Email"; // email
export const SHOP_ORDER_NAME_PROPERTY = "Customer Name"; // rich_text
export const SHOP_ORDER_TOTAL_PROPERTY = "Total"; // number
export const SHOP_ORDER_STATUS_PROPERTY = "Status"; // status (workflow)
export const SHOP_ORDER_SHIPPING_PROPERTY = "Shipping Address"; // rich_text
export const SHOP_ORDER_CLIENT_PROPERTY = "Client"; // relation -> Client CRM
// Relation to the inventory rows purchased on this order, so units/best-sellers
// roll up instead of living only as free-text bullets (roadmap: "relate shop
// orders to inventory rows"). Additive alongside the bullets, and gated behind
// `NOTION_RELATION_LINKS` (the property must exist first, or the create 404s) —
// so it's only written when the caller resolves inventory page ids. Named apart
// from the legacy free-text `Items` property (Etsy receipts) it complements.
export const SHOP_ORDER_ITEMS_PROPERTY = "Inventory Items"; // relation -> inventory
// Set by the cancellation-refund flow when the atelier cancels a shop order
// (`setShopOrderCancelled`). Additive marker (absent ⇒ false), like the custom
// order's `Cancelled` checkbox — read back so the tracking page shows a
// cancelled state. See `services/order-cancellation.service.ts`.
export const SHOP_ORDER_CANCELLED_PROPERTY = "Cancelled"; // checkbox
// The atelier's own "this order no longer consumes stock" marker, ticked in the
// same write as `Cancelled`. It is what the order lines' `Counts Toward Sold`
// formula reads (through their `Order Voided` rollup), so ticking it is how a
// cancelled order's units go back on the shelf — without it a refunded order
// would hold its stock forever once lines started being written. Kept as a
// SEPARATE property from `Cancelled` because they answer different questions:
// `Cancelled` is the customer-facing state the tracking page renders, `Voided`
// is the bookkeeping fact the rollups travel, and the atelier ticks `Voided` by
// hand for an order the app never took money for. See
// `services/order-lines.service.ts`.
export const SHOP_ORDER_VOIDED_PROPERTY = "Voided"; // checkbox
// Set by the return/exchange refund flow (`services/return-refund.service.ts`)
// after a refund succeeds. Both are ATELIER VISIBILITY ONLY — correctness rests
// entirely on Stripe's own refund total, so the write is best-effort and a
// database that doesn't have these properties yet still refunds correctly
// (writing a property that doesn't exist 400s the PATCH). Absent ⇒ 0 / false.
export const SHOP_ORDER_REFUNDED_PROPERTY = "Refunded Amount"; // number (dollars)
export const SHOP_ORDER_RETURN_PROCESSED_PROPERTY = "Return Processed"; // checkbox
// Which sales channel the order came from. The atelier has always filed Etsy
// receipts, skate-shop sales and word-of-mouth orders into this same database by
// hand, so a channel-blind read of it reports every one of them as if the
// website had taken the money. The app stamps its OWN channel here for the
// converse reason: without it, the orders the app writes are the ones with no
// channel, and the studio's figures could attribute the website's takings to
// nothing at all.
//
// Additive, and read back by the studio analytics — see
// `services/studio-analytics.service.ts`. The option list itself is the
// atelier's (they can add a channel without a deploy); only the one value the
// app writes is named here.
export const SHOP_ORDER_CHANNEL_PROPERTY = "Sales Channel"; // select
/**
 * The `Sales Channel` option an order the app took belongs to.
 *
 * A TARGETED BUSINESS RULE naming one live Notion option value, like
 * `STATUS_IN_STOCK` and `REVIEW_STATUS_PUBLISHED` — rename this option in Notion
 * and it must change here too, or every website order starts writing a channel
 * Notion silently drops and the figures lose the online store. Everything reads
 * degrade-safely if that happens (an order with no channel is reported as
 * unattributed, never quietly folded into another channel).
 */
export const SHOP_ORDER_ONLINE_STORE_CHANNEL = "Online Store";
// When the order was placed. Notion's own page-creation time is the right answer
// for an order the app wrote — the two happen within a second of each other —
// but it is badly wrong for the ones typed in by hand, where it records the
// evening the atelier caught up on paperwork rather than the day of the sale.
// So every order carries a real date: the app stamps the moment it was paid, the
// atelier fills theirs in, and the figures read one property for all of them
// (falling back to the page's creation time when it's blank).
export const SHOP_ORDER_DATE_PROPERTY = "Order Date"; // date
// Carrier tracking, filled in by the atelier once the order ships. All three are
// additive and optional (absent until set): the number is what's shown to the
// customer, the URL makes it a clickable link, and the carrier is a display
// label. The app never writes these — they're an atelier signal, read back so
// the tracking page can surface them. See "Shop-order tracking" in CLAUDE.md.
export const SHOP_ORDER_TRACKING_NUMBER_PROPERTY = "Tracking Number"; // rich_text
export const SHOP_ORDER_TRACKING_CARRIER_PROPERTY = "Carrier"; // rich_text
export const SHOP_ORDER_TRACKING_URL_PROPERTY = "Tracking URL"; // url

/**
 * A human-readable shop order number the customer can track their order by
 * (surfaced on the success page + stored on the order). Mirrors the custom-order
 * `generateOrderNumber` but with a distinct "SHP-" prefix. Generated at checkout
 * and carried to the webhook via the Stripe session metadata.
 */
export function generateShopOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `SHP-${timestamp}-${random}`;
}

/**
 * The "Status" option a freshly-paid order lands in. Must be one of the live
 * options on the Shop Orders "Status" property (a status-type workflow:
 * New / Payment Confirmed / Processing / …). "Payment Confirmed" is where the
 * Stripe payment lands the order; the atelier advances it from there.
 */
export const SHOP_ORDER_PAID_STATUS = "Payment Confirmed";

/**
 * When the checkout was paid, as an ISO instant for the `Order Date` property.
 *
 * Stripe stamps `created` (unix seconds) on the session, which is the moment the
 * customer started checkout — within a minute or two of paying, and the only
 * time the session itself carries. A session with no usable `created` falls back
 * to now, which is when the webhook is being handled: near enough, and never
 * absent, since a blank date would send the order back to being dated by
 * whenever Notion happened to create the page.
 */
function paidAt(session: Stripe.Checkout.Session): string {
  const seconds = session.created;
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    const at = new Date(seconds * 1000);
    if (!Number.isNaN(at.getTime())) return at.toISOString();
  }
  return new Date().toISOString();
}

/** Stripe amounts are integer minor units (cents); Notion "Total" is dollars. */
function toDollars(amountInCents: number | null | undefined): number {
  return typeof amountInCents === "number" ? amountInCents / 100 : 0;
}

function formatMoney(amountInCents: number | null | undefined): string {
  return `$${toDollars(amountInCents).toFixed(2)}`;
}

/**
 * A one-line shipping address from whichever field Stripe populated. The
 * property moved between API versions (`shipping_details` ->
 * `collected_information.shipping_details`), so read defensively.
 */
export function formatShippingAddress(
  session: Stripe.Checkout.Session,
): string | null {
  const loose = session as unknown as {
    collected_information?: { shipping_details?: { address?: AddressParts } };
    shipping_details?: { address?: AddressParts };
    customer_details?: { address?: AddressParts | null };
  };
  const address =
    loose.collected_information?.shipping_details?.address ??
    loose.shipping_details?.address ??
    loose.customer_details?.address ??
    null;
  if (!address) return null;

  const parts = [
    address.line1,
    address.line2,
    [address.city, address.state, address.postal_code]
      .filter(Boolean)
      .join(" "),
    address.country,
  ].filter((part): part is string => Boolean(part && part.trim()));

  return parts.length > 0 ? parts.join(", ") : null;
}

interface AddressParts {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

/**
 * Notion page `properties` for a paid shop order. When `clientPageId` is given
 * (the webhook upserted a Client CRM record for the buyer's email), the order is
 * linked to it through the `Client` relation — the same pattern as custom orders.
 */
export function buildShopOrderProperties(
  session: Stripe.Checkout.Session,
  clientPageId?: string,
  itemPageIds?: string[],
): Record<string, unknown> {
  const email = session.customer_details?.email ?? undefined;
  const name = session.customer_details?.name ?? undefined;
  const shipping = formatShippingAddress(session);
  // The order number is minted at checkout and carried on the session metadata.
  const orderNumber = session.metadata?.orderNumber ?? undefined;
  const label = name ?? email ?? session.id;
  const title = orderNumber
    ? `Shop order ${orderNumber} — ${label}`
    : `Shop order — ${label}`;

  const properties: Record<string, unknown> = {
    [SHOP_ORDER_TITLE_PROPERTY]: {
      title: [{ text: { content: title } }],
    },
    [SHOP_ORDER_SESSION_PROPERTY]: {
      rich_text: [{ text: { content: session.id } }],
    },
    [SHOP_ORDER_TOTAL_PROPERTY]: {
      number: toDollars(session.amount_total),
    },
    [SHOP_ORDER_STATUS_PROPERTY]: {
      status: { name: SHOP_ORDER_PAID_STATUS },
    },
    // This order came through the website. Written unconditionally, so the
    // atelier never has to remember to tag one — and so a blank channel means
    // one thing only: a row somebody typed and didn't file.
    [SHOP_ORDER_CHANNEL_PROPERTY]: {
      select: { name: SHOP_ORDER_ONLINE_STORE_CHANNEL },
    },
    // A full instant rather than a calendar date: the studio's own timezone
    // decides which day a late-evening order belongs to, and that decision
    // belongs where the figures are read, not here.
    [SHOP_ORDER_DATE_PROPERTY]: { date: { start: paidAt(session) } },
  };

  if (orderNumber) {
    properties[SHOP_ORDER_NUMBER_PROPERTY] = {
      rich_text: [{ text: { content: orderNumber } }],
    };
  }
  if (email) {
    properties[SHOP_ORDER_EMAIL_PROPERTY] = { email: normalizeEmail(email) };
  }
  if (name) {
    properties[SHOP_ORDER_NAME_PROPERTY] = {
      rich_text: [{ text: { content: name } }],
    };
  }
  if (shipping) {
    properties[SHOP_ORDER_SHIPPING_PROPERTY] = {
      rich_text: [{ text: { content: shipping } }],
    };
  }
  if (clientPageId) {
    properties[SHOP_ORDER_CLIENT_PROPERTY] = {
      relation: [{ id: clientPageId }],
    };
  }
  // Gated on the caller resolving inventory page ids (NOTION_RELATION_LINKS on +
  // the variant metadata present). Deduped so an item bought twice links once.
  if (itemPageIds && itemPageIds.length > 0) {
    properties[SHOP_ORDER_ITEMS_PROPERTY] = {
      relation: itemPageIds.map((id) => ({ id })),
    };
  }

  return properties;
}

/** Notion page body (`children`) blocks: a heading + one bullet per line item. */
export function buildShopOrderPageBlocks(
  session: Stripe.Checkout.Session,
): unknown[] {
  const lineItems = session.line_items?.data ?? [];

  const heading = {
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [{ type: "text", text: { content: "Items" } }],
    },
  };

  const bullets = lineItems.map((item) => {
    const quantity = item.quantity ?? 1;
    const description = item.description ?? "Item";
    const amount = formatMoney(item.amount_total);
    return bulletBlock(`${quantity} × ${description} — ${amount}`);
  });

  // Shipping and tax are separate from line items in Stripe, but they're part of
  // the Total — surface them so the bullets and the Total property reconcile.
  const shipping = session.total_details?.amount_shipping ?? 0;
  if (shipping > 0) {
    bullets.push(bulletBlock(`Shipping — ${formatMoney(shipping)}`));
  }
  const tax = session.total_details?.amount_tax ?? 0;
  if (tax > 0) {
    bullets.push(bulletBlock(`Tax — ${formatMoney(tax)}`));
  }

  return [heading, ...bullets];
}

function bulletBlock(content: string) {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: [{ type: "text", text: { content } }],
    },
  };
}
