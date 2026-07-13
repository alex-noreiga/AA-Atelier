// Order persistence + lookup against the Notion orders database.
//
// The live "Stage" option list is read from the database schema with a short
// in-memory TTL cache (the atelier edits stages directly in Notion and expects
// changes without a redeploy). On a fetch error we fall back to the cached list
// rather than failing the request.

import { getNotionClient, type NotionClient } from "./client.js";
import { buildOrderProperties, buildOrderPageBlocks } from "./blocks.js";
import {
  ORDER_NUMBER_PROPERTY,
  ORDER_DEPOSIT_PAID_PROPERTY,
  ORDER_DEPOSIT_SESSION_PROPERTY,
  extractStageOptions,
  extractOrderName,
  extractCurrentStage,
  extractDepositAmount,
  extractDepositPaid,
  type CreateOrderInput,
  type NotionDatabaseSchema,
  type NotionQueryResponse,
  type OrderRecord,
} from "./schema.js";

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
): Promise<string> {
  assertConfigured(client);

  const orderNumber = generateOrderNumber();

  const body: Record<string, unknown> = {
    parent: { database_id: client.databaseId },
    properties: buildOrderProperties(data, orderNumber),
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

  const depositAmount = extractDepositAmount(page);
  return {
    orderNumber: trimmedOrderNumber,
    orderName: extractOrderName(page),
    currentStage: extractCurrentStage(page),
    stages,
    ...(depositAmount !== undefined ? { depositAmount } : {}),
    depositPaid: extractDepositPaid(page),
  };
}

/** A custom order's deposit state plus its Notion page id, for the deposit flow. */
export interface DepositTarget {
  pageId: string;
  orderName: string;
  depositAmount?: number;
  depositPaid: boolean;
}

/**
 * Look up just what the deposit flow needs: the order's Notion page id (so the
 * webhook can mark it paid) and its current deposit state. Returns null when no
 * order matches the number.
 */
export async function findDepositTarget(
  orderNumber: string,
  client: NotionClient = getNotionClient(),
): Promise<DepositTarget | null> {
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

  const depositAmount = extractDepositAmount(page);
  return {
    pageId: page.id,
    orderName: extractOrderName(page),
    ...(depositAmount !== undefined ? { depositAmount } : {}),
    depositPaid: extractDepositPaid(page),
  };
}

/**
 * Mark a custom order's deposit as paid, recording the Stripe session id.
 * Called from the webhook. Setting the same values on redelivery is harmless,
 * so this is idempotent.
 */
export async function markDepositPaid(
  pageId: string,
  sessionId: string,
  client: NotionClient = getNotionClient(),
): Promise<void> {
  assertConfigured(client);

  const response = await client.fetch(`/v1/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [ORDER_DEPOSIT_PAID_PROPERTY]: { checkbox: true },
        [ORDER_DEPOSIT_SESSION_PROPERTY]: {
          rich_text: [{ text: { content: sessionId } }],
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion deposit update failed with status ${response.status}: ${errorText}`,
    );
  }
}
