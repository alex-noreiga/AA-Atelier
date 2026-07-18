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
  ORDER_DUE_DATE_PROPERTY,
  ORDER_MILESTONES_GENERATED_PROPERTY,
  extractStageOptions,
  extractOrderNumber,
  extractOrderName,
  extractCurrentStage,
  extractInvoiceRelationId,
  extractDueDate,
  extractOrderEmail,
  type CreateOrderInput,
  type NotionDatabaseSchema,
  type NotionQueryResponse,
  type OrderRecord,
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
  return {
    orderNumber: trimmedOrderNumber,
    orderName: extractOrderName(page),
    currentStage: extractCurrentStage(page),
    stages,
    pageId: page.id,
    ...(estimatedCompletion !== undefined ? { estimatedCompletion } : {}),
    ...(invoicePageId !== undefined ? { invoicePageId } : {}),
  };
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

/** What the measurement-change gates need about an order: the email to verify
 * against, plus the current stage and the live ordered stage list to decide
 * whether measurements are still editable. Kept separate from `OrderRecord`
 * (the public status view) so the email is never returned by order lookup. */
export interface OrderVerification {
  email: string;
  currentStage: string;
  stages: string[];
}

export async function findOrderForMeasurementChange(
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
