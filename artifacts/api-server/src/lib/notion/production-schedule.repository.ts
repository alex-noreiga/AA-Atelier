// Milestone persistence against the "📅 Production Schedule" Notion database.
// Called from the reconciliation service (schedule.service.ts) when an order has
// a due date but no milestones yet. `orderHasMilestones` is the per-order
// idempotency guard: it looks up existing milestones by the `Order` relation, so
// a re-run (or a checkbox that didn't stick) doesn't create duplicate rows.

import {
  getProductionScheduleNotionClient,
  type NotionClient,
} from "./client.js";
import {
  buildMilestoneProperties,
  PS_ORDER_RELATION_PROPERTY,
  type MilestoneInput,
} from "./production-schedule.blocks.js";

interface NotionQueryResponse {
  results: Array<{ id: string }>;
}

function assertConfigured(client: NotionClient): void {
  if (!client.databaseId) {
    throw new Error(
      "NOTION_PRODUCTION_SCHEDULE_DATABASE_ID is not configured for the production-schedule database",
    );
  }
}

/** Whether any milestone row is already linked to this order (via the relation). */
export async function orderHasMilestones(
  orderPageId: string,
  client: NotionClient = getProductionScheduleNotionClient(),
): Promise<boolean> {
  assertConfigured(client);

  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: PS_ORDER_RELATION_PROPERTY,
          relation: { contains: orderPageId },
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

/** Create one per-stage milestone page in the Production Schedule database. */
export async function createMilestone(
  input: MilestoneInput,
  client: NotionClient = getProductionScheduleNotionClient(),
): Promise<void> {
  assertConfigured(client);

  const body: Record<string, unknown> = {
    parent: { database_id: client.databaseId },
    properties: buildMilestoneProperties(input),
  };

  const response = await client.fetch("/v1/pages", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion milestone creation failed with status ${response.status}: ${errorText}`,
    );
  }
}
