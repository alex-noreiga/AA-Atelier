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
} from "./shop-orders.blocks.js";

interface NotionQueryResponse {
  results: Array<{ id: string }>;
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
