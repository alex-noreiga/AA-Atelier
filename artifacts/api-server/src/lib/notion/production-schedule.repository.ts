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
  buildMilestoneStatusUpdate,
  PS_ORDER_RELATION_PROPERTY,
  PS_STAGE_PROPERTY,
  PS_STATUS_PROPERTY,
  PS_TARGET_DATE_PROPERTY,
  type MilestoneInput,
  type MilestoneStatus,
  type StageMilestone,
} from "./production-schedule.blocks.js";

interface NotionQueryResponse {
  results: Array<{ id: string }>;
}

// A widened view of a queried milestone row, exposing just the two properties
// the status timeline reads back. Stage is a `select` on the Production Schedule
// DB (unlike the orders DB, where it's a `status`); Target Completion Date is a
// `date`. Both are read defensively — a row missing either is skipped.
interface MilestoneRow {
  properties?: {
    [PS_STAGE_PROPERTY]?: { select?: { name?: string } | null };
    [PS_TARGET_DATE_PROPERTY]?: { date?: { start?: string } | null };
  };
}

interface MilestoneQueryResponse {
  results: MilestoneRow[];
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

/**
 * Read back the per-stage target dates for an order (by its `Order` relation),
 * for the customer status timeline. Unlike the write path this is *optional* and
 * best-effort: if the Production Schedule database isn't configured, or the query
 * fails, it returns `[]` so a Production Schedule outage never breaks the core
 * status lookup (mirrors `fetchLiveOrderStages`'s fail-soft degradation).
 */
export async function listOrderMilestones(
  orderPageId: string,
  client: NotionClient = getProductionScheduleNotionClient(),
): Promise<StageMilestone[]> {
  if (!client.databaseId) {
    return [];
  }

  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: PS_ORDER_RELATION_PROPERTY,
          relation: { contains: orderPageId },
        },
      }),
    },
  );

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as MilestoneQueryResponse;
  const milestones: StageMilestone[] = [];
  for (const row of data.results) {
    const stage = row.properties?.[PS_STAGE_PROPERTY]?.select?.name;
    const targetDate = row.properties?.[PS_TARGET_DATE_PROPERTY]?.date?.start;
    if (stage && targetDate) {
      milestones.push({ stage, targetDate });
    }
  }
  return milestones;
}

// A milestone row as the status reconciliation reads it: the page id (to patch),
// its stage label (Production Stage select), and its current completion Status.
interface MilestonePageRow {
  id: string;
  properties?: {
    [PS_STAGE_PROPERTY]?: { select?: { name?: string } | null };
    [PS_STATUS_PROPERTY]?: { status?: { name?: string } | null };
  };
}

interface MilestonePageQueryResponse {
  results: MilestonePageRow[];
}

/** One milestone page, reduced to what the status sync needs. */
export interface MilestonePage {
  pageId: string;
  /** Production Stage select value; `""` if the row has none. */
  stage: string;
  /** Current completion Status; `""` if unset. */
  status: string;
}

/**
 * List an order's milestone pages (by the `Order` relation) with their stage and
 * current status, so the reconciliation can advance any whose status has drifted
 * from the order's live stage. Fail-soft on an unconfigured database (returns
 * `[]`, like `listOrderMilestones`) so a missing Production Schedule never turns
 * the reconciliation into an alert storm; a query error still throws so the
 * per-order guard in the service logs and retries it.
 */
export async function listOrderMilestonePages(
  orderPageId: string,
  client: NotionClient = getProductionScheduleNotionClient(),
): Promise<MilestonePage[]> {
  if (!client.databaseId) {
    return [];
  }

  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: PS_ORDER_RELATION_PROPERTY,
          relation: { contains: orderPageId },
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Notion query failed with status ${response.status}`);
  }

  const data = (await response.json()) as MilestonePageQueryResponse;
  return data.results.map((row) => ({
    pageId: row.id,
    stage: row.properties?.[PS_STAGE_PROPERTY]?.select?.name ?? "",
    status: row.properties?.[PS_STATUS_PROPERTY]?.status?.name ?? "",
  }));
}

/** Set a single milestone page's completion `Status` (leaves stage/date/relation
 * untouched). Used by the reconciliation to keep milestones in step with the
 * order's stage. */
export async function updateMilestoneStatus(
  pageId: string,
  status: MilestoneStatus,
  client: NotionClient = getProductionScheduleNotionClient(),
): Promise<void> {
  assertConfigured(client);

  const response = await client.fetch(`/v1/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: buildMilestoneStatusUpdate(status) }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion milestone status update failed with status ${response.status}: ${errorText}`,
    );
  }
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
