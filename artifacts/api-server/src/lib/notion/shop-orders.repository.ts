// Paid-shop-order persistence against the Notion "Shop Orders" database. Called
// from the Stripe webhook once a checkout completes. Writes are idempotent: the
// Stripe session id is stored as a property and looked up before creating, so a
// re-delivered `checkout.session.completed` event does not create a duplicate.

import type Stripe from "stripe";
import { getShopOrdersNotionClient, type NotionClient } from "./client.js";
import {
  buildShopOrderProperties,
  buildShopOrderPageBlocks,
  SHOP_ORDER_NUMBER_PROPERTY,
  SHOP_ORDER_SESSION_PROPERTY,
  SHOP_ORDER_STATUS_PROPERTY,
  SHOP_ORDER_TOTAL_PROPERTY,
} from "./shop-orders.blocks.js";

interface NotionQueryResponse {
  results: Array<{ id: string }>;
}

/** A shop order as read back for the customer-facing tracking lookup. */
export interface ShopOrderRecord {
  orderNumber: string;
  status: string;
  total?: number;
}

// Raw Notion property shapes we read back (only the types we touch).
type NotionReadProperty =
  | { type: "rich_text"; rich_text: Array<{ plain_text: string }> }
  | { type: "status"; status: { name: string } | null }
  | { type: "number"; number: number | null };

interface NotionLookupResponse {
  results: Array<{
    id: string;
    properties: Record<string, NotionReadProperty | undefined>;
  }>;
}

interface NotionShopOrdersSchema {
  properties: Record<
    string,
    { type: string; status?: { options: Array<{ name: string }> } }
  >;
}

const STATUS_CACHE_TTL_MS = 60_000;
let cachedStatuses: { statuses: string[]; fetchedAt: number } | null = null;

function assertConfigured(client: NotionClient): void {
  if (!client.databaseId) {
    throw new Error(
      "NOTION_SHOP_ORDERS_DATABASE_ID is not configured for the shop-orders database",
    );
  }
}

function readRichText(prop: NotionReadProperty | undefined): string {
  if (prop?.type !== "rich_text") return "";
  return prop.rich_text
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

function readStatus(prop: NotionReadProperty | undefined): string {
  if (prop?.type !== "status") return "";
  return prop.status?.name ?? "";
}

function readNumber(prop: NotionReadProperty | undefined): number | null {
  if (prop?.type !== "number") return null;
  return prop.number;
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

/** Create the Notion page for a completed checkout session. When `clientPageId`
 * is given, the order is linked to that Client CRM record (`Client` relation). */
export async function createShopOrder(
  session: Stripe.Checkout.Session,
  client: NotionClient = getShopOrdersNotionClient(),
  clientPageId?: string,
): Promise<void> {
  assertConfigured(client);

  const body: Record<string, unknown> = {
    parent: { database_id: client.databaseId },
    properties: buildShopOrderProperties(session, clientPageId),
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

/**
 * Look up a shop order by its human-readable order number. `Order Number` is a
 * rich_text property, so the filter must use `rich_text: { equals }` (the same
 * gotcha as the custom-order lookup). Returns null when no order matches.
 */
export async function findShopOrderByNumber(
  orderNumber: string,
  client: NotionClient = getShopOrdersNotionClient(),
): Promise<ShopOrderRecord | null> {
  assertConfigured(client);

  const trimmed = orderNumber.trim();
  if (!trimmed) return null;

  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: SHOP_ORDER_NUMBER_PROPERTY,
          rich_text: { equals: trimmed },
        },
        page_size: 1,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Notion query failed with status ${response.status}`);
  }

  const data = (await response.json()) as NotionLookupResponse;
  const page = data.results[0];
  if (!page) return null;

  const total = readNumber(page.properties[SHOP_ORDER_TOTAL_PROPERTY]);
  return {
    orderNumber:
      readRichText(page.properties[SHOP_ORDER_NUMBER_PROPERTY]) || trimmed,
    status: readStatus(page.properties[SHOP_ORDER_STATUS_PROPERTY]),
    ...(total !== null ? { total } : {}),
  };
}

/**
 * The live ordered list of "Status" workflow options, read from the database
 * schema so the tracking timeline follows the atelier's edits without a
 * redeploy (never hardcode it). Cached for {@link STATUS_CACHE_TTL_MS}; falls
 * back to the cached list on error, and to an empty list if never fetched.
 */
export async function fetchLiveShopOrderStatuses(
  client: NotionClient = getShopOrdersNotionClient(),
): Promise<string[]> {
  assertConfigured(client);

  if (
    cachedStatuses &&
    Date.now() - cachedStatuses.fetchedAt < STATUS_CACHE_TTL_MS
  ) {
    return cachedStatuses.statuses;
  }

  try {
    const response = await client.fetch(`/v1/databases/${client.databaseId}`);
    if (!response.ok) {
      throw new Error(
        `Notion database schema fetch failed with status ${response.status}`,
      );
    }

    const schema = (await response.json()) as NotionShopOrdersSchema;
    const statuses =
      schema.properties[SHOP_ORDER_STATUS_PROPERTY]?.status?.options.map(
        (option) => option.name,
      ) ?? [];
    cachedStatuses = { statuses, fetchedAt: Date.now() };
    return statuses;
  } catch (error) {
    if (cachedStatuses) {
      return cachedStatuses.statuses;
    }
    throw error;
  }
}
