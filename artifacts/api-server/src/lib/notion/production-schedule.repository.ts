// Milestone persistence against the "📅 Production Schedule" Notion database.
// Called from the reconciliation service (schedule.service.ts) when an order has
// a due date but no milestones yet. `orderHasMilestones` is the per-order
// idempotency guard: it looks up existing milestones by the `Order` relation, so
// a re-run (or a checkbox that didn't stick) doesn't create duplicate rows.

import { logger } from "../logger.js";
import {
  getProductionScheduleNotionClient,
  type NotionClient,
  assertDatabaseConfigured,
} from "./client.js";
import {
  buildMilestoneProperties,
  buildMilestoneStatusUpdate,
  buildReminderSentUpdate,
  MILESTONE_STATUS_COMPLETED,
  MILESTONE_STATUS_IN_PROGRESS,
  PS_ORDER_RELATION_PROPERTY,
  PS_REMINDER_SENT_PROPERTY,
  PS_STAGE_PROPERTY,
  PS_STATUS_PROPERTY,
  PS_TARGET_DATE_PROPERTY,
  type FittingReminderMilestone,
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
  assertDatabaseConfigured(
    client,
    "NOTION_PRODUCTION_SCHEDULE_DATABASE_ID is not configured for the production-schedule database",
  );
}

/**
 * Whether a non-ok query response is Notion's 400 validation_error for a filter
 * that references the (optional) `Reminder Sent` checkbox before the atelier has
 * added it — Notion answers "Could not find property with name or id: Reminder
 * Sent". That property is the fitting-reminder feature's one-time setup step; if
 * it's missing the feature simply isn't configured yet, which is a benign state,
 * not an incident. We treat it exactly like an unset database id (degrade to a
 * no-op) so the nightly reconciliation doesn't fire an error-level alert on every
 * run until the property is added. Requires both the 400 status and the property
 * name in Notion's "could not find property" message, so an unrelated 400 still
 * surfaces (throws) as before.
 */
function isMissingReminderSentProperty(status: number, body: string): boolean {
  return (
    status === 400 &&
    body.includes(PS_REMINDER_SENT_PROPERTY) &&
    /could not find property/i.test(body)
  );
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
    const body = await response.text();
    throw new Error(
      `Notion query failed with status ${response.status}: ${body}`,
    );
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
    const body = await response.text();
    throw new Error(
      `Notion query failed with status ${response.status}: ${body}`,
    );
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

// A milestone row as the fitting-reminder pass reads it: the page id, its stage +
// target date (for the email), and the linked order's page id (to resolve the
// customer email). `Order` is a relation; the reminder needs the first linked id.
interface FittingReminderRow {
  id: string;
  properties?: {
    [PS_STAGE_PROPERTY]?: { select?: { name?: string } | null };
    [PS_TARGET_DATE_PROPERTY]?: { date?: { start?: string } | null };
    [PS_ORDER_RELATION_PROPERTY]?: { relation?: Array<{ id: string }> | null };
  };
}

interface FittingReminderQueryResponse {
  results: FittingReminderRow[];
}

/**
 * Find fitting milestones that are due for a reminder: their `Production Stage` is
 * one of the configured fitting stages, they aren't completed, no reminder has been
 * sent yet, and *either* the target date is on or before the cutoff (the reminder
 * window) *or* the order has already reached the fitting stage (`Status = In
 * Progress`). The second clause is what catches an order running ahead of schedule —
 * it reaches Fitting before the target date, so a date-only filter would never fire
 * before the stage advances to Completed and the reminder is missed entirely.
 * (`syncMilestoneStatuses` runs before this in `reconcileMilestones`, so the status
 * reflects the order's live stage.) Rows missing a stage or an order relation are
 * skipped (nothing to email about). Fail-soft on an unconfigured database (returns
 * `[]`), but a query error throws so the caller logs and retries next run —
 * mirroring `listOrderMilestonePages`.
 */
export async function findMilestonesNeedingFittingReminder(
  params: { stages: string[]; onOrBefore: string },
  client: NotionClient = getProductionScheduleNotionClient(),
): Promise<FittingReminderMilestone[]> {
  if (!client.databaseId) {
    return [];
  }
  if (params.stages.length === 0) {
    return [];
  }

  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        filter: {
          and: [
            {
              or: params.stages.map((stage) => ({
                property: PS_STAGE_PROPERTY,
                select: { equals: stage },
              })),
            },
            {
              property: PS_STATUS_PROPERTY,
              status: { does_not_equal: MILESTONE_STATUS_COMPLETED },
            },
            {
              // Due by the cutoff (the scheduled heads-up) OR the order is already
              // at the fitting stage (the "you're here now, book it" trigger).
              or: [
                {
                  property: PS_TARGET_DATE_PROPERTY,
                  date: { on_or_before: params.onOrBefore },
                },
                {
                  property: PS_STATUS_PROPERTY,
                  status: { equals: MILESTONE_STATUS_IN_PROGRESS },
                },
              ],
            },
            {
              property: PS_REMINDER_SENT_PROPERTY,
              checkbox: { equals: false },
            },
          ],
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    // The `Reminder Sent` checkbox is an optional one-time setup step; if the
    // atelier hasn't added it, the fitting reminder simply isn't configured yet.
    // Degrade to a no-op (like an unset database id) instead of alerting nightly.
    if (isMissingReminderSentProperty(response.status, body)) {
      logger.warn(
        `Fitting reminders skipped: the "${PS_REMINDER_SENT_PROPERTY}" checkbox ` +
          `is missing from the Production Schedule database. Add it to enable ` +
          `fitting reminders (see CLAUDE.md "Automated fitting reminders").`,
      );
      return [];
    }
    throw new Error(
      `Notion query failed with status ${response.status}: ${body}`,
    );
  }

  const data = (await response.json()) as FittingReminderQueryResponse;
  const milestones: FittingReminderMilestone[] = [];
  for (const row of data.results) {
    const stage = row.properties?.[PS_STAGE_PROPERTY]?.select?.name;
    const targetDate = row.properties?.[PS_TARGET_DATE_PROPERTY]?.date?.start;
    const orderPageId =
      row.properties?.[PS_ORDER_RELATION_PROPERTY]?.relation?.[0]?.id;
    if (stage && targetDate && orderPageId) {
      milestones.push({ pageId: row.id, stage, targetDate, orderPageId });
    }
  }
  return milestones;
}

/** Mark a milestone's fitting reminder as sent (flips the `Reminder Sent`
 * checkbox), so the nightly reconciliation doesn't re-send it. */
export async function markFittingReminderSent(
  pageId: string,
  client: NotionClient = getProductionScheduleNotionClient(),
): Promise<void> {
  assertConfigured(client);

  const response = await client.fetch(`/v1/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: buildReminderSentUpdate() }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion fitting-reminder marker update failed with status ${response.status}: ${errorText}`,
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
