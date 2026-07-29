// Order persistence + lookup against the Notion orders database.
//
// The live "Stage" option list is read from the database schema with a short
// in-memory TTL cache (the atelier edits stages directly in Notion and expects
// changes without a redeploy). On a fetch error we fall back to the cached list
// rather than failing the request.

import { getNotionClient, type NotionClient } from "./client.js";
import { buildOrderProperties, buildOrderPageBlocks } from "./orders.blocks.js";
import {
  ORDER_NUMBER_PROPERTY,
  ORDER_EMAIL_PROPERTY,
  ORDER_DUE_DATE_PROPERTY,
  ORDER_MILESTONES_GENERATED_PROPERTY,
  ORDER_LAST_NOTIFIED_STAGE_PROPERTY,
  ORDER_CANCELLED_PROPERTY,
  extractStageOptions,
  extractOrderNumber,
  extractOrderName,
  extractCurrentStage,
  extractInvoiceRelationId,
  extractCostingItemIds,
  extractDueDate,
  extractRush,
  extractCancelled,
  extractOrderEmail,
  extractLastNotifiedStage,
  type CreateOrderInput,
  type NotionDatabaseSchema,
  type NotionOrderPage,
  type NotionQueryResponse,
  type OrderRecord,
  type OrderSummary,
} from "./orders.schema.js";

const STAGE_CACHE_TTL_MS = 60_000;
let cachedStages: { stages: string[]; fetchedAt: number } | null = null;

async function fetchLiveOrderStages(client: NotionClient): Promise<string[]> {
  if (
    cachedStages &&
    Date.now() - cachedStages.fetchedAt < STAGE_CACHE_TTL_MS
  ) {
    return cachedStages.stages;
  }

  const response = await client.fetch(`/v1/databases/${client.databaseId}`);
  if (!response.ok) {
    if (cachedStages) {
      return cachedStages.stages;
    }
    throw new Error(
      `Notion database schema fetch failed with status ${response.status}`,
    );
  }

  const data = (await response.json()) as NotionDatabaseSchema;
  const stages = extractStageOptions(data);

  cachedStages = { stages, fetchedAt: Date.now() };
  return stages;
}

function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ORD-${timestamp}-${random}`;
}

function assertConfigured(client: NotionClient): void {
  if (!client.databaseId) {
    throw new Error(
      "NOTION_ORDERS_DATABASE_ID is not configured for the orders database",
    );
  }
}

export async function createOrder(
  data: CreateOrderInput,
  client: NotionClient = getNotionClient(),
  clientPageId?: string,
): Promise<string> {
  assertConfigured(client);

  const orderNumber = generateOrderNumber();

  const body: Record<string, unknown> = {
    parent: { database_id: client.databaseId },
    properties: buildOrderProperties(data, orderNumber, clientPageId),
    children: buildOrderPageBlocks(data),
  };

  const response = await client.fetch("/v1/pages", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion page creation failed with status ${response.status}: ${errorText}`,
    );
  }

  return orderNumber;
}

export async function findOrderByNumber(
  orderNumber: string,
  client: NotionClient = getNotionClient(),
): Promise<OrderRecord | null> {
  assertConfigured(client);

  const trimmedOrderNumber = orderNumber.trim();
  if (!trimmedOrderNumber) {
    return null;
  }

  const [response, stages] = await Promise.all([
    client.fetch(`/v1/databases/${client.databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: ORDER_NUMBER_PROPERTY,
          rich_text: { equals: trimmedOrderNumber },
        },
        page_size: 1,
      }),
    }),
    fetchLiveOrderStages(client),
  ]);

  if (!response.ok) {
    throw new Error(`Notion query failed with status ${response.status}`);
  }

  const data = (await response.json()) as NotionQueryResponse;
  const page = data.results[0];
  if (!page) {
    return null;
  }

  const estimatedCompletion = extractDueDate(page);
  const invoicePageId = extractInvoiceRelationId(page);
  const costingItemIds = extractCostingItemIds(page);
  return {
    orderNumber: trimmedOrderNumber,
    orderName: extractOrderName(page),
    currentStage: extractCurrentStage(page),
    stages,
    pageId: page.id,
    ...(estimatedCompletion !== undefined ? { estimatedCompletion } : {}),
    ...(invoicePageId !== undefined ? { invoicePageId } : {}),
    ...(costingItemIds.length > 0 ? { costingItemIds } : {}),
    ...(extractRush(page) ? { rush: true } : {}),
    ...(extractCancelled(page) ? { cancelled: true } : {}),
  };
}

/**
 * Find every custom order placed under a customer's email, for the account
 * portal. Filters on the `Email` property (`email: { equals }`) and paginates the
 * full result set (a customer may have several orders — unlike the single-order
 * lookups). The live ordered stage list is fetched once and shared across the
 * summaries so a card can show progress. Returns a lightweight {@link OrderSummary}
 * per order (no milestone/invoice fan-out — those load on the detail pages).
 *
 * Note: Notion's email `equals` is exact, so an order stored under a differently-
 * cased address than the sign-in email won't match. Orders created before the
 * `Email` property existed have no address to match and are invisible here —
 * the customer can still track those by number.
 */
export async function findOrdersByEmail(
  email: string,
  client: NotionClient = getNotionClient(),
): Promise<OrderSummary[]> {
  assertConfigured(client);

  const trimmed = email.trim();
  if (!trimmed) return [];

  const stages = await fetchLiveOrderStages(client);
  const summaries: OrderSummary[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.fetch(
      `/v1/databases/${client.databaseId}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: {
            property: ORDER_EMAIL_PROPERTY,
            email: { equals: trimmed },
          },
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Notion query failed with status ${response.status}`);
    }

    const data = (await response.json()) as NotionQueryResponse & {
      has_more?: boolean;
      next_cursor?: string | null;
    };

    for (const page of data.results) {
      const orderNumber = extractOrderNumber(page);
      if (!orderNumber) continue;
      const estimatedCompletion = extractDueDate(page);
      summaries.push({
        orderNumber,
        orderName: extractOrderName(page),
        currentStage: extractCurrentStage(page),
        stages,
        ...(estimatedCompletion !== undefined ? { estimatedCompletion } : {}),
      });
    }

    cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (cursor);

  return summaries;
}

/** An order that has a due date set but whose per-stage milestones haven't been
 * generated yet — the unit of work for the reconciliation cron. `stages` is the
 * live ordered "Stage" option list the schedule is derived from. */
export interface PendingMilestoneOrder {
  pageId: string;
  orderNumber: string;
  orderName: string;
  currentStage: string;
  dueDate: string;
  stages: string[];
}

/**
 * Query custom orders with a `Due Date` set, split by whether their milestones
 * have been generated. Returns the live ordered stage list alongside each order
 * (fetched once, shared) so callers don't hardcode stages. Orders with an empty
 * due date are skipped defensively even though the filter already excludes them.
 */
async function queryOrdersByMilestoneState(
  client: NotionClient,
  milestonesGenerated: boolean,
): Promise<PendingMilestoneOrder[]> {
  assertConfigured(client);

  const [response, stages] = await Promise.all([
    client.fetch(`/v1/databases/${client.databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({
        filter: {
          and: [
            {
              property: ORDER_DUE_DATE_PROPERTY,
              date: { is_not_empty: true },
            },
            {
              property: ORDER_MILESTONES_GENERATED_PROPERTY,
              checkbox: { equals: milestonesGenerated },
            },
          ],
        },
      }),
    }),
    fetchLiveOrderStages(client),
  ]);

  if (!response.ok) {
    throw new Error(`Notion query failed with status ${response.status}`);
  }

  const data = (await response.json()) as NotionQueryResponse;
  const orders: PendingMilestoneOrder[] = [];
  for (const page of data.results) {
    const dueDate = extractDueDate(page);
    if (!dueDate) continue;
    orders.push({
      pageId: page.id,
      orderNumber: extractOrderNumber(page),
      orderName: extractOrderName(page),
      currentStage: extractCurrentStage(page),
      dueDate,
      stages,
    });
  }
  return orders;
}

/**
 * Find custom orders that need milestones: `Due Date` is set and
 * `Milestones Generated` is not yet checked — the unit of work for the
 * generation pass of the reconciliation.
 */
export function findOrdersNeedingMilestones(
  client: NotionClient = getNotionClient(),
): Promise<PendingMilestoneOrder[]> {
  return queryOrdersByMilestoneState(client, false);
}

/**
 * Find custom orders that already have milestones (`Due Date` set and
 * `Milestones Generated` checked) — the ones the status-sync pass re-checks so
 * each milestone's completion state tracks the order's live stage instead of
 * being frozen at "Not Started".
 */
export function findOrdersWithMilestones(
  client: NotionClient = getNotionClient(),
): Promise<PendingMilestoneOrder[]> {
  return queryOrdersByMilestoneState(client, true);
}

/**
 * Mark an order's milestones as generated so the reconciliation cron won't
 * regenerate them. Setting the same value again is harmless, so this is
 * idempotent. To force a reschedule the atelier unchecks this in Notion.
 */
export async function markMilestonesGenerated(
  pageId: string,
  client: NotionClient = getNotionClient(),
): Promise<void> {
  assertConfigured(client);

  const response = await client.fetch(`/v1/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [ORDER_MILESTONES_GENERATED_PROPERTY]: { checkbox: true },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion milestones-generated update failed with status ${response.status}: ${errorText}`,
    );
  }
}

/** What the status-change notification needs about an order: the recipient email
 * (never exposed by the public order lookup) and the order's page id (to write the
 * marker back), plus the fields the email renders — the order name/number, the
 * live pipeline, the current stage, the target completion date, and the
 * last-notified stage marker that gates the send to forward movement. Kept
 * separate from `OrderRecord` so email stays out of the public status view. */
export interface OrderStageNotification {
  pageId: string;
  orderNumber: string;
  orderName: string;
  email: string;
  currentStage: string;
  stages: string[];
  /** The furthest stage already emailed about; empty when never notified. */
  lastNotifiedStage: string;
  estimatedCompletion?: string;
}

/** Map a Notion order page (+ the live stage list) to the notification view. */
function buildStageNotification(
  page: NotionOrderPage,
  stages: string[],
  fallbackNumber = "",
): OrderStageNotification {
  const estimatedCompletion = extractDueDate(page);
  return {
    pageId: page.id,
    orderNumber: extractOrderNumber(page) || fallbackNumber,
    orderName: extractOrderName(page),
    email: extractOrderEmail(page),
    currentStage: extractCurrentStage(page),
    stages,
    lastNotifiedStage: extractLastNotifiedStage(page),
    ...(estimatedCompletion !== undefined ? { estimatedCompletion } : {}),
  };
}

/**
 * Look up an order for a status-change email by its number, including the
 * customer email (which `findOrderByNumber` deliberately omits from the public
 * view). Returns null when the order number is blank or no order matches.
 */
export async function findOrderForStageNotification(
  orderNumber: string,
  client: NotionClient = getNotionClient(),
): Promise<OrderStageNotification | null> {
  assertConfigured(client);

  const trimmedOrderNumber = orderNumber.trim();
  if (!trimmedOrderNumber) {
    return null;
  }

  const [response, stages] = await Promise.all([
    client.fetch(`/v1/databases/${client.databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: ORDER_NUMBER_PROPERTY,
          rich_text: { equals: trimmedOrderNumber },
        },
        page_size: 1,
      }),
    }),
    fetchLiveOrderStages(client),
  ]);

  if (!response.ok) {
    throw new Error(`Notion query failed with status ${response.status}`);
  }

  const data = (await response.json()) as NotionQueryResponse;
  const page = data.results[0];
  if (!page) {
    return null;
  }

  return buildStageNotification(page, stages, trimmedOrderNumber);
}

/**
 * Look up an order for a status-change email by its Notion **page id**, for the
 * Notion automation webhook — its default payload carries the triggering page's
 * id (`data.id`) but no easily-authored body, so we resolve straight off that id.
 * Re-reads the authoritative page (never trusts the payload's own copy). Returns
 * null when the id is blank or the page no longer exists.
 */
export async function findOrderForStageNotificationByPageId(
  pageId: string,
  client: NotionClient = getNotionClient(),
): Promise<OrderStageNotification | null> {
  assertConfigured(client);

  const trimmedPageId = pageId.trim();
  if (!trimmedPageId) {
    return null;
  }

  const [response, stages] = await Promise.all([
    client.fetch(`/v1/pages/${trimmedPageId}`),
    fetchLiveOrderStages(client),
  ]);

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Notion page fetch failed with status ${response.status}`);
  }

  const page = (await response.json()) as NotionOrderPage;
  return buildStageNotification(page, stages);
}

/**
 * Record the stage the customer was last emailed about (the marker the
 * status-change webhook reads to notify only on forward movement). Written after
 * a notification is sent; setting the same value again is harmless (idempotent).
 */
export async function updateLastNotifiedStage(
  pageId: string,
  stage: string,
  client: NotionClient = getNotionClient(),
): Promise<void> {
  assertConfigured(client);

  const response = await client.fetch(`/v1/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [ORDER_LAST_NOTIFIED_STAGE_PROPERTY]: {
          rich_text: [{ text: { content: stage } }],
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion last-notified-stage update failed with status ${response.status}: ${errorText}`,
    );
  }
}

/** What an order-scoped gate needs about an order: the email to verify against,
 * plus the current stage and the live ordered stage list to decide whether an
 * action is still allowed (measurements editable, order delivered, …). Kept
 * separate from `OrderRecord` (the public status view) so the email is never
 * returned by order lookup. */
export interface OrderVerification {
  email: string;
  currentStage: string;
  stages: string[];
}

/** Look up an order for a gated, email-verified action (a measurement change or
 * a post-delivery review). Returns the stored email + the live stage list, or
 * null when the order number is blank or unknown. */
export async function findOrderVerification(
  orderNumber: string,
  client: NotionClient = getNotionClient(),
): Promise<OrderVerification | null> {
  assertConfigured(client);

  const trimmedOrderNumber = orderNumber.trim();
  if (!trimmedOrderNumber) {
    return null;
  }

  const [response, stages] = await Promise.all([
    client.fetch(`/v1/databases/${client.databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: ORDER_NUMBER_PROPERTY,
          rich_text: { equals: trimmedOrderNumber },
        },
        page_size: 1,
      }),
    }),
    fetchLiveOrderStages(client),
  ]);

  if (!response.ok) {
    throw new Error(`Notion query failed with status ${response.status}`);
  }

  const data = (await response.json()) as NotionQueryResponse;
  const page = data.results[0];
  if (!page) {
    return null;
  }

  // TODO(measurements-b): also return page.id here — the direct in-place PATCH
  // path (Approach B) will target `PATCH /v1/pages/{id}` with this id.
  return {
    email: extractOrderEmail(page),
    currentStage: extractCurrentStage(page),
    stages,
  };
}

/** @deprecated Prefer {@link findOrderVerification}. Kept so the measurement-
 * change flow's existing imports (and their tests) keep resolving. */
export { findOrderVerification as findOrderForMeasurementChange };

/** What the atelier cancellation-refund flow needs about a custom order: the
 * page id (to mark it cancelled), the order name + email (for the confirmation
 * email), and the linked invoice page id (to find the paid Stripe sessions to
 * refund). Kept apart from the public status view so the email is never returned
 * by order lookup. */
export interface OrderCancellationTarget {
  pageId: string;
  orderNumber: string;
  orderName: string;
  email: string;
  invoicePageId?: string;
  /** Whether the order is already marked cancelled (a re-press no-ops). */
  cancelled: boolean;
}

/** Look up a custom order for the atelier's cancellation-refund action. Returns
 * null when the order number is blank or unknown. */
export async function findOrderForCancellation(
  orderNumber: string,
  client: NotionClient = getNotionClient(),
): Promise<OrderCancellationTarget | null> {
  assertConfigured(client);

  const trimmedOrderNumber = orderNumber.trim();
  if (!trimmedOrderNumber) {
    return null;
  }

  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: ORDER_NUMBER_PROPERTY,
          rich_text: { equals: trimmedOrderNumber },
        },
        page_size: 1,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Notion query failed with status ${response.status}`);
  }

  const data = (await response.json()) as NotionQueryResponse;
  const page = data.results[0];
  if (!page) {
    return null;
  }

  const invoicePageId = extractInvoiceRelationId(page);
  return {
    pageId: page.id,
    orderNumber: extractOrderNumber(page) || trimmedOrderNumber,
    orderName: extractOrderName(page),
    email: extractOrderEmail(page),
    cancelled: extractCancelled(page),
    ...(invoicePageId !== undefined ? { invoicePageId } : {}),
  };
}

/** Mark a custom order cancelled by setting its `Cancelled` checkbox. Written by
 * the cancellation-refund flow after the refunds succeed; setting the same value
 * again is harmless (idempotent), like {@link markMilestonesGenerated}. */
export async function setOrderCancelled(
  pageId: string,
  client: NotionClient = getNotionClient(),
): Promise<void> {
  assertConfigured(client);

  const response = await client.fetch(`/v1/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [ORDER_CANCELLED_PROPERTY]: { checkbox: true },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion order cancelled update failed with status ${response.status}: ${errorText}`,
    );
  }
}
