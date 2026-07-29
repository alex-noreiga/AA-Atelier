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
  SHOP_ORDER_EMAIL_PROPERTY,
  SHOP_ORDER_STATUS_PROPERTY,
  SHOP_ORDER_TOTAL_PROPERTY,
  SHOP_ORDER_CANCELLED_PROPERTY,
} from "./shop-orders.blocks.js";

interface NotionQueryResponse {
  results: Array<{ id: string }>;
}

/** A shop order as read back for the customer-facing tracking lookup. */
export interface ShopOrderRecord {
  orderNumber: string;
  status: string;
  total?: number;
  /** True once the atelier has cancelled the order (`Cancelled` checkbox). */
  cancelled?: boolean;
}

// Raw Notion property shapes we read back (only the types we touch).
type NotionReadProperty =
  | { type: "rich_text"; rich_text: Array<{ plain_text: string }> }
  | { type: "status"; status: { name: string } | null }
  | { type: "number"; number: number | null }
  | { type: "email"; email: string | null }
  | { type: "checkbox"; checkbox: boolean };

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

function readEmail(prop: NotionReadProperty | undefined): string {
  if (prop?.type !== "email") return "";
  return (prop.email ?? "").trim();
}

function readCheckbox(prop: NotionReadProperty | undefined): boolean {
  if (prop?.type !== "checkbox") return false;
  return prop.checkbox;
}

/** What a shop-order-scoped gate needs: the email to verify the requester
 * against. Kept separate from {@link ShopOrderRecord} (the public tracking view)
 * so the email is never returned by the status lookup — the shop-order analogue
 * of the custom order's {@link findOrderVerification}. */
export interface ShopOrderVerification {
  email: string;
}

/**
 * Look up a shop order for a gated, email-verified action (a return/exchange
 * request). Filters on the `Order Number` rich_text property (same `rich_text:
 * { equals }` gotcha as the tracking lookup) and returns the stored
 * `Customer Email`, or null when the number is blank or unknown. A legacy order
 * with no stored email returns an empty string, which the caller treats as
 * "unverifiable" rather than a mismatch.
 */
export async function findShopOrderVerification(
  orderNumber: string,
  client: NotionClient = getShopOrdersNotionClient(),
): Promise<ShopOrderVerification | null> {
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

  return { email: readEmail(page.properties[SHOP_ORDER_EMAIL_PROPERTY]) };
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
    ...(readCheckbox(page.properties[SHOP_ORDER_CANCELLED_PROPERTY])
      ? { cancelled: true }
      : {}),
  };
}

/** What the atelier cancellation-refund flow needs about a shop order: the page
 * id (to mark it cancelled), the stored email (to verify a request + address the
 * confirmation email), and the Stripe session id (to issue the refund). Returns
 * null when the order number is blank or unknown. */
export interface ShopOrderCancellationTarget {
  pageId: string;
  orderNumber: string;
  email: string;
  sessionId: string;
  status: string;
  cancelled: boolean;
}

export async function findShopOrderForCancellation(
  orderNumber: string,
  client: NotionClient = getShopOrdersNotionClient(),
): Promise<ShopOrderCancellationTarget | null> {
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

  return {
    pageId: page.id,
    orderNumber:
      readRichText(page.properties[SHOP_ORDER_NUMBER_PROPERTY]) || trimmed,
    email: readEmail(page.properties[SHOP_ORDER_EMAIL_PROPERTY]),
    sessionId: readRichText(page.properties[SHOP_ORDER_SESSION_PROPERTY]),
    status: readStatus(page.properties[SHOP_ORDER_STATUS_PROPERTY]),
    cancelled: readCheckbox(page.properties[SHOP_ORDER_CANCELLED_PROPERTY]),
  };
}

/** Mark a shop order cancelled by setting its `Cancelled` checkbox. Idempotent,
 * like the custom order's {@link setOrderCancelled}. */
export async function setShopOrderCancelled(
  pageId: string,
  client: NotionClient = getShopOrdersNotionClient(),
): Promise<void> {
  assertConfigured(client);

  const response = await client.fetch(`/v1/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [SHOP_ORDER_CANCELLED_PROPERTY]: { checkbox: true },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion shop-order cancelled update failed with status ${response.status}: ${errorText}`,
    );
  }
}

/**
 * Find every shop order placed under a customer's email, for the account portal.
 * Filters on the `Customer Email` property and paginates the full result set.
 * Orders with no `Order Number` (placed before that property shipped) are omitted
 * — they can't be tracked, so there's nothing to link to. Same email-`equals`
 * exactness caveat as the custom-order lookup.
 */
export async function findShopOrdersByEmail(
  email: string,
  client: NotionClient = getShopOrdersNotionClient(),
): Promise<ShopOrderRecord[]> {
  assertConfigured(client);

  const trimmed = email.trim();
  if (!trimmed) return [];

  const orders: ShopOrderRecord[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.fetch(
      `/v1/databases/${client.databaseId}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: {
            property: SHOP_ORDER_EMAIL_PROPERTY,
            email: { equals: trimmed },
          },
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Notion query failed with status ${response.status}`);
    }

    const data = (await response.json()) as NotionLookupResponse & {
      has_more?: boolean;
      next_cursor?: string | null;
    };

    for (const page of data.results) {
      const orderNumber = readRichText(
        page.properties[SHOP_ORDER_NUMBER_PROPERTY],
      );
      if (!orderNumber) continue;
      const total = readNumber(page.properties[SHOP_ORDER_TOTAL_PROPERTY]);
      orders.push({
        orderNumber,
        status: readStatus(page.properties[SHOP_ORDER_STATUS_PROPERTY]),
        ...(total !== null ? { total } : {}),
      });
    }

    cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (cursor);

  return orders;
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
