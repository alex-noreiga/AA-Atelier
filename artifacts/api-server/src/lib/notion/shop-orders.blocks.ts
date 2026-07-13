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

// Live-schema property names (a Notion rename is a one-line change here).
export const SHOP_ORDER_TITLE_PROPERTY = "Order"; // title
export const SHOP_ORDER_SESSION_PROPERTY = "Stripe Session Id"; // rich_text
export const SHOP_ORDER_EMAIL_PROPERTY = "Customer Email"; // email
export const SHOP_ORDER_NAME_PROPERTY = "Customer Name"; // rich_text
export const SHOP_ORDER_TOTAL_PROPERTY = "Total"; // number
export const SHOP_ORDER_STATUS_PROPERTY = "Status"; // select
export const SHOP_ORDER_SHIPPING_PROPERTY = "Shipping Address"; // rich_text

/** The "Status" value a freshly-paid order lands in. */
export const SHOP_ORDER_PAID_STATUS = "Paid";

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

/** Notion page `properties` for a paid shop order. */
export function buildShopOrderProperties(
  session: Stripe.Checkout.Session,
): Record<string, unknown> {
  const email = session.customer_details?.email ?? undefined;
  const name = session.customer_details?.name ?? undefined;
  const shipping = formatShippingAddress(session);
  const title = name
    ? `Shop order — ${name}`
    : email
      ? `Shop order — ${email}`
      : `Shop order — ${session.id}`;

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
      select: { name: SHOP_ORDER_PAID_STATUS },
    },
  };

  if (email) {
    properties[SHOP_ORDER_EMAIL_PROPERTY] = { email };
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
    return {
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [
          {
            type: "text",
            text: { content: `${quantity} × ${description} — ${amount}` },
          },
        ],
      },
    };
  });

  return [heading, ...bullets];
}
