// Paid-shop-order persistence against the Notion "Shop Orders" database. Called
// from the Stripe webhook once a checkout completes. Writes are idempotent: the
// Stripe session id is stored as a property and looked up before creating, so a
// re-delivered `checkout.session.completed` event does not create a duplicate.

import type Stripe from "stripe";
import {
  getShopOrdersNotionClient,
  assertDatabaseConfigured,
  type NotionClient,
} from "./client.js";
import { normalizeEmail } from "../email.js";
import { scanDatabase } from "./scan.js";
import {
  buildShopOrderProperties,
  buildShopOrderPageBlocks,
  SHOP_ORDER_NUMBER_PROPERTY,
  SHOP_ORDER_SESSION_PROPERTY,
  SHOP_ORDER_EMAIL_PROPERTY,
  SHOP_ORDER_STATUS_PROPERTY,
  SHOP_ORDER_TOTAL_PROPERTY,
  SHOP_ORDER_CANCELLED_PROPERTY,
  SHOP_ORDER_VOIDED_PROPERTY,
  SHOP_ORDER_REFUNDED_PROPERTY,
  SHOP_ORDER_RETURN_PROCESSED_PROPERTY,
  SHOP_ORDER_TRACKING_NUMBER_PROPERTY,
  SHOP_ORDER_TRACKING_CARRIER_PROPERTY,
  SHOP_ORDER_TRACKING_URL_PROPERTY,
  SHOP_ORDER_DELIVERY_METHOD_PROPERTY,
  SHOP_ORDER_SHIP_BY_PROPERTY,
  SHOP_ORDER_PICKUP_TIME_PROPERTY,
  SHOP_ORDER_PICKUP_LOCATION_PROPERTY,
  SHOP_ORDER_ITEMS_PROPERTY,
} from "./shop-orders.blocks.js";
import type { FulfilmentFields } from "../fulfilment.js";
import { createPageDroppingUnknownProperties } from "./create-page.js";
import { logger } from "../logger.js";

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
  /** The raw shipping/collection columns — carrier tracking, the ship-by date,
   * or a scheduled local pickup. Unresolved on purpose: `getShopOrderStatus`
   * needs the live status list to know whether the order is already fulfilled
   * before it can decide what to say. Absent when none are set. */
  fulfilmentFields?: FulfilmentFields;
}

// Raw Notion property shapes we read back (only the types we touch).
type NotionReadProperty =
  | { type: "rich_text"; rich_text: Array<{ plain_text: string }> }
  | { type: "status"; status: { name: string } | null }
  | { type: "select"; select: { name: string } | null }
  | { type: "number"; number: number | null }
  | { type: "email"; email: string | null }
  | { type: "checkbox"; checkbox: boolean }
  | { type: "url"; url: string | null }
  | { type: "date"; date: { start: string; end: string | null } | null }
  | { type: "relation"; relation: Array<{ id: string }> };

interface NotionLookupResponse {
  results: NotionShopOrderPage[];
}

interface NotionShopOrderPage {
  id: string;
  /** Notion's page-creation timestamp (ISO) — when the order was paid for, and
   * the only date the studio analytics can place a shop order in a month by. */
  created_time?: string;
  properties: Record<string, NotionReadProperty | undefined>;
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
  assertDatabaseConfigured(
    client,
    "NOTION_SHOP_ORDERS_DATABASE_ID is not configured for the shop-orders database",
  );
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

function readSelect(prop: NotionReadProperty | undefined): string {
  if (prop?.type !== "select") return "";
  return prop.select?.name ?? "";
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

function readUrl(prop: NotionReadProperty | undefined): string {
  if (prop?.type !== "url") return "";
  return (prop.url ?? "").trim();
}

function readRelationIds(prop: NotionReadProperty | undefined): string[] {
  if (prop?.type !== "relation") return [];
  return prop.relation.map((entry) => entry.id);
}

/** A Notion `date` property's `start`, or "" when unset. */
function readDate(prop: NotionReadProperty | undefined): string {
  if (prop?.type !== "date") return "";
  return prop.date?.start ?? "";
}

/**
 * Read the order's shipping/collection columns verbatim into the shared
 * {@link FulfilmentFields} — what any of it means is decided by
 * `lib/fulfilment.ts`, the same rules the custom orders go through.
 *
 * A shop order has no `Fulfilment` select of its own: its `Status` workflow IS
 * the fulfilment state, and the tracking page already renders that as the
 * timeline, so `state` is deliberately left unset rather than repeating it.
 *
 * `Shipping Address` is deliberately not read: this lookup is gated by order
 * number alone, so returning the customer's own address would hand it to anyone
 * holding the number. The pickup *location* is the studio's address, so it's safe.
 */
function readFulfilmentFields(
  properties: Record<string, NotionReadProperty | undefined>,
): FulfilmentFields {
  const method = readSelect(properties[SHOP_ORDER_DELIVERY_METHOD_PROPERTY]);
  const trackingNumber = readRichText(
    properties[SHOP_ORDER_TRACKING_NUMBER_PROPERTY],
  );
  const carrier = readRichText(
    properties[SHOP_ORDER_TRACKING_CARRIER_PROPERTY],
  );
  const trackingUrl = readUrl(properties[SHOP_ORDER_TRACKING_URL_PROPERTY]);
  const shipBy = readDate(properties[SHOP_ORDER_SHIP_BY_PROPERTY]);
  const pickupAt = readDate(properties[SHOP_ORDER_PICKUP_TIME_PROPERTY]);
  const pickupLocation = readRichText(
    properties[SHOP_ORDER_PICKUP_LOCATION_PROPERTY],
  );

  return {
    ...(method ? { method } : {}),
    ...(trackingNumber ? { trackingNumber } : {}),
    ...(carrier ? { carrier } : {}),
    ...(trackingUrl ? { trackingUrl } : {}),
    ...(shipBy ? { shipBy } : {}),
    ...(pickupAt ? { pickupAt } : {}),
    ...(pickupLocation ? { pickupLocation } : {}),
  };
}

/** What a shop-order-scoped gate needs: the email to verify the requester
 * against. Kept separate from {@link ShopOrderRecord} (the public tracking view)
 * so the email is never returned by the status lookup — the shop-order analogue
 * of the custom order's {@link findOrderVerification}. */
export interface ShopOrderVerification {
  pageId: string;
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

  return {
    pageId: page.id,
    email: readEmail(page.properties[SHOP_ORDER_EMAIL_PROPERTY]),
  };
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
  itemPageIds?: string[],
): Promise<string> {
  assertConfigured(client);

  // Dropping-and-retrying an un-added property matters more here than on the
  // intake form: this runs on the Stripe webhook, so a 400 over `Delivery
  // Method` would lose a PAID order until the atelier added the column (the
  // redelivery would fail the same way). Same helper the order intake uses.
  const created = await createPageDroppingUnknownProperties(
    client,
    buildShopOrderProperties(session, clientPageId, itemPageIds),
    buildShopOrderPageBlocks(session),
    "shop orders",
  );
  return created.id;
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
  const fulfilmentFields = readFulfilmentFields(page.properties);
  return {
    orderNumber:
      readRichText(page.properties[SHOP_ORDER_NUMBER_PROPERTY]) || trimmed,
    status: readStatus(page.properties[SHOP_ORDER_STATUS_PROPERTY]),
    ...(total !== null ? { total } : {}),
    ...(readCheckbox(page.properties[SHOP_ORDER_CANCELLED_PROPERTY])
      ? { cancelled: true }
      : {}),
    ...(Object.keys(fulfilmentFields).length > 0 ? { fulfilmentFields } : {}),
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
  /** Dollars recorded as refunded by a previous run of either atelier refund
   * flow. DISPLAY ONLY — the return-refund service always re-reads the real
   * total from Stripe, so a stale/absent value here can't cause a double
   * refund. Absent (or the property not added yet) reads as 0. */
  refundedAmount: number;
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
    refundedAmount:
      readNumber(page.properties[SHOP_ORDER_REFUNDED_PROPERTY]) ?? 0,
  };
}

/**
 * Record the outcome of a return/exchange refund on the shop order: the
 * cumulative dollars refunded and a `Return Processed` marker.
 *
 * BEST-EFFORT BY DESIGN — unlike {@link setShopOrderCancelled}, this resolves to
 * `false` instead of throwing when the write fails. The refund has already been
 * issued in Stripe by the time this runs, and Stripe (not this marker) is what
 * the next run reads to decide whether anything is owed, so a failed write costs
 * the atelier visibility, never correctness. This is also what lets the flow work
 * before the two properties are added to the database (Notion 400s a PATCH that
 * names an unknown property).
 *
 * @returns true when the properties were written, false when the write failed.
 */
export async function recordShopOrderRefund(
  pageId: string,
  refundedAmount: number,
  client: NotionClient = getShopOrdersNotionClient(),
): Promise<boolean> {
  assertConfigured(client);

  try {
    const response = await client.fetch(`/v1/pages/${pageId}`, {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          [SHOP_ORDER_REFUNDED_PROPERTY]: { number: refundedAmount },
          [SHOP_ORDER_RETURN_PROCESSED_PROPERTY]: { checkbox: true },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(
        { pageId, status: response.status, errorText },
        "Could not record the refund on the shop order (refund itself succeeded)",
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(
      { err, pageId },
      "Could not record the refund on the shop order (refund itself succeeded)",
    );
    return false;
  }
}

/** Mark a shop order cancelled by setting its `Cancelled` checkbox — and its
 * `Voided` checkbox in the same write, which is what puts the order's units back
 * on the shelf: the order lines' `Counts Toward Sold` formula stops counting a
 * voided order, so the inventory's `Units Sold (auto)` rollup falls back. The
 * two are written together because a cancelled-and-refunded order that still
 * consumed stock would be silently wrong. Idempotent, like the custom order's
 * {@link setOrderCancelled}.
 *
 * A returned/exchanged order deliberately does NOT get voided here — whether a
 * returned piece goes back on the shelf is the atelier's call (it may come back
 * unsellable), so `Voided` stays theirs to tick. */
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
        [SHOP_ORDER_VOIDED_PROPERTY]: { checkbox: true },
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

  const trimmed = normalizeEmail(email);
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
      const record = pageToShopOrder(page);
      if (record) orders.push(record);
    }

    cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (cursor);

  return orders;
}

/** Map a Notion shop-order page to a tracking record, or null when it has no
 * order number (placed before that property shipped — nothing to link to). */
function pageToShopOrder(
  page: NotionLookupResponse["results"][number],
): ShopOrderRecord | null {
  const orderNumber = readRichText(page.properties[SHOP_ORDER_NUMBER_PROPERTY]);
  if (!orderNumber) return null;
  const total = readNumber(page.properties[SHOP_ORDER_TOTAL_PROPERTY]);
  return {
    orderNumber,
    status: readStatus(page.properties[SHOP_ORDER_STATUS_PROPERTY]),
    ...(total !== null ? { total } : {}),
  };
}

/**
 * Fetch shop-order records for a set of order numbers in a single query (one
 * Notion `or` filter, chunked at 100), preserving the input order. The account
 * portal discovers the numbers from the Postgres index, then calls this for the
 * live fulfilment `Status`.
 */
export async function findShopOrdersByNumbers(
  numbers: string[],
  client: NotionClient = getShopOrdersNotionClient(),
): Promise<ShopOrderRecord[]> {
  assertConfigured(client);

  const unique = [...new Set(numbers.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) return [];

  const byNumber = new Map<string, ShopOrderRecord>();

  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const response = await client.fetch(
      `/v1/databases/${client.databaseId}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: {
            or: chunk.map((n) => ({
              property: SHOP_ORDER_NUMBER_PROPERTY,
              rich_text: { equals: n },
            })),
          },
          page_size: 100,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Notion query failed with status ${response.status}`);
    }

    const data = (await response.json()) as NotionLookupResponse;
    for (const page of data.results) {
      const record = pageToShopOrder(page);
      if (record) byNumber.set(record.orderNumber, record);
    }
  }

  return unique
    .map((n) => byNumber.get(n))
    .filter((r): r is ShopOrderRecord => r !== undefined);
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

/** A shop order reduced to what the studio analytics aggregate over. Unlike
 * {@link ShopOrderRecord} this keeps orders with no `Order Number` — a legacy
 * order can't be *tracked*, but its money and its fulfilment status still
 * count — and carries the purchased inventory ids the best-seller list is
 * built from. */
export interface ShopOrderAnalyticsRecord {
  orderNumber: string;
  status: string;
  total?: number;
  cancelled: boolean;
  /** Notion's page-creation time (ISO) — when the order was paid. */
  createdTime: string;
  /** Inventory page ids from the `Inventory Items` relation. Empty for orders
   * placed before that relation was written (or with it switched off), which is
   * why the best-seller list can legitimately come back empty. */
  itemIds: string[];
}

/**
 * Read every shop order for the studio analytics, alongside the live fulfilment
 * status list (the never-hardcode rule again). A bounded full-database scan, the
 * shop-order counterpart of `listOrdersForAnalytics`.
 */
export async function listShopOrdersForAnalytics(
  client: NotionClient = getShopOrdersNotionClient(),
): Promise<{ orders: ShopOrderAnalyticsRecord[]; statuses: string[] }> {
  assertConfigured(client);

  const [pages, statuses] = await Promise.all([
    scanDatabase<NotionShopOrderPage>(client, "shop orders"),
    fetchLiveShopOrderStatuses(client),
  ]);

  const orders = pages.map((page) => {
    const total = readNumber(page.properties[SHOP_ORDER_TOTAL_PROPERTY]);
    return {
      orderNumber: readRichText(page.properties[SHOP_ORDER_NUMBER_PROPERTY]),
      status: readStatus(page.properties[SHOP_ORDER_STATUS_PROPERTY]),
      cancelled: readCheckbox(page.properties[SHOP_ORDER_CANCELLED_PROPERTY]),
      createdTime: page.created_time ?? "",
      itemIds: readRelationIds(page.properties[SHOP_ORDER_ITEMS_PROPERTY]),
      ...(total !== null ? { total } : {}),
    } satisfies ShopOrderAnalyticsRecord;
  });

  return { orders, statuses };
}
