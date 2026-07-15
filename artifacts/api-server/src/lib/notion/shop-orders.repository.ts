// Paid-shop-order persistence against the Notion "Shop Orders" database. Called
// from the Stripe webhook once a checkout completes. Writes are idempotent: the
// Stripe session id is stored as a property and looked up before creating, so a
// re-delivered `checkout.session.completed` event does not create a duplicate.

import type Stripe from "stripe";
import { getShopOrdersNotionClient, type NotionClient } from "./client.js";
import {
  buildShopOrderProperties,
  buildShopOrderPageBlocks,
  SHOP_ORDER_SESSION_PROPERTY,
  SHOP_ORDER_EMAIL_PROPERTY,
} from "./shop-orders.blocks.js";

interface NotionQueryResponse {
  results: Array<{ id: string }>;
}

/** A queried shop-order page, narrowed to the one property the review flow reads. */
interface ShopOrderPage {
  id: string;
  properties?: {
    [key: string]:
      | { type: "rich_text"; rich_text: Array<{ plain_text: string }> }
      | undefined;
  };
}

interface ShopOrderQueryResponse {
  results: ShopOrderPage[];
}

/** A paid shop order matched for review verification. */
export interface ShopOrderMatch {
  /** The Stripe session id recorded on the order (used as the review's reference). */
  sessionId: string;
}

function assertConfigured(client: NotionClient): void {
  if (!client.databaseId) {
    throw new Error(
      "NOTION_SHOP_ORDERS_DATABASE_ID is not configured for the shop-orders database",
    );
  }
}

/** Whether an order has already been recorded for this Stripe session. */
export async function findOrderBySessionId(
  sessionId: string,
  client: NotionClient = getShopOrdersNotionClient(),
): Promise<boolean> {
  assertConfigured(client);

  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: SHOP_ORDER_SESSION_PROPERTY,
          rich_text: { equals: sessionId },
        },
        page_size: 1,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Notion query failed with status ${response.status}`);
  }

  const data = (await response.json()) as NotionQueryResponse;
  return data.results.length > 0;
}

/**
 * Find the most recent paid shop order placed with the given email, for review
 * verification. Shop orders carry no human order number, so a shop customer
 * proves their purchase with the email they checked out with. Returns the
 * matched order's Stripe session id (used as the review's traceable reference),
 * or null when no order matches.
 *
 * The Customer Email is a Notion `email` property; the filter's `equals` is
 * exact. Stripe normalises checkout emails to lower case, so we look up the
 * trimmed/lower-cased email — a mixed-case stored value is the only edge this
 * would miss, and a human still moderates every review.
 */
export async function findPaidShopOrderByEmail(
  email: string,
  client: NotionClient = getShopOrdersNotionClient(),
): Promise<ShopOrderMatch | null> {
  assertConfigured(client);

  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: SHOP_ORDER_EMAIL_PROPERTY,
          email: { equals: normalized },
        },
        sorts: [{ timestamp: "created_time", direction: "descending" }],
        page_size: 1,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Notion query failed with status ${response.status}`);
  }

  const data = (await response.json()) as ShopOrderQueryResponse;
  const page = data.results[0];
  if (!page) {
    return null;
  }

  const sessionProp = page.properties?.[SHOP_ORDER_SESSION_PROPERTY];
  const sessionId =
    sessionProp?.type === "rich_text"
      ? sessionProp.rich_text.map((t) => t.plain_text).join("")
      : "";

  return { sessionId };
}

/** Create the Notion page for a completed checkout session. */
export async function createShopOrder(
  session: Stripe.Checkout.Session,
  client: NotionClient = getShopOrdersNotionClient(),
): Promise<void> {
  assertConfigured(client);

  const body: Record<string, unknown> = {
    parent: { database_id: client.databaseId },
    properties: buildShopOrderProperties(session),
    children: buildShopOrderPageBlocks(session),
  };

  const response = await client.fetch("/v1/pages", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion shop-order creation failed with status ${response.status}: ${errorText}`,
    );
  }
}
