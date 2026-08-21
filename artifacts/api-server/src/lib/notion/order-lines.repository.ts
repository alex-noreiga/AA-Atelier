// Order-line persistence against the Notion "order lines" database — one row per
// item purchased on a shop order, written by the Stripe webhook right after the
// shop order's own page. These rows are what move the inventory's
// `Units Sold (auto)` rollup, and so `Quantity Available` (see
// `order-lines.blocks.ts` for why that's the whole mechanism).
//
// OPTIONAL BY DESIGN: unset `NOTION_ORDER_LINES_DATABASE_ID` ⇒
// `orderLinesConfigured()` is false and the caller skips the whole pass, which
// is exactly the pre-lines behavior (the order is still recorded; stock just
// doesn't decrement). That keeps a workspace that hasn't shared the database
// with the integration from failing a paid order over bookkeeping.

import {
  getOrderLinesNotionClient,
  assertDatabaseConfigured,
  type NotionClient,
} from "./client.js";
import {
  buildOrderLineProperties,
  type OrderLineInput,
} from "./order-lines.blocks.js";

function assertConfigured(client: NotionClient): void {
  assertDatabaseConfigured(
    client,
    "NOTION_ORDER_LINES_DATABASE_ID is not configured for the order-lines database",
  );
}

/** Whether the order-lines database is configured. Unset ⇒ the caller skips
 * writing lines entirely rather than throwing — stock stays manual, as before. */
export function orderLinesConfigured(
  client: NotionClient = getOrderLinesNotionClient(),
): boolean {
  return Boolean(client.databaseId);
}

/** Create one order-line row. Throws on a Notion failure; the caller records
 * lines best-effort so a failure never fails the paid order. */
export async function createOrderLine(
  input: OrderLineInput,
  client: NotionClient = getOrderLinesNotionClient(),
): Promise<void> {
  assertConfigured(client);

  const response = await client.fetch("/v1/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: client.databaseId },
      properties: buildOrderLineProperties(input),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion order line creation failed with status ${response.status}: ${errorText}`,
    );
  }
}
