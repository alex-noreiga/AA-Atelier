import { describe, it, expect } from "vitest";
import {
  createMilestone,
  findMilestonesNeedingFittingReminder,
  listOrderMilestones,
  markFittingReminderSent,
  orderHasMilestones,
} from "../../src/lib/notion/production-schedule.repository.js";
import {
  MILESTONE_STATUS_COMPLETED,
  MILESTONE_STATUS_IN_PROGRESS,
  PS_MILESTONE_STATUS_PROPERTY,
  PS_ORDER_RELATION_PROPERTY,
  PS_REMINDER_SENT_PROPERTY,
  PS_STAGE_PROPERTY,
  PS_TARGET_DATE_PROPERTY,
  type MilestoneInput,
} from "../../src/lib/notion/production-schedule.blocks.js";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
} from "../support/fake-notion.js";

const milestone: MilestoneInput = {
  orderPageId: "order-page-1",
  projectName: "Ada – Custom Dress — Fitting",
  stage: "Fitting",
  targetDate: "2026-08-15",
};

const isQuery = (path: string) => path.endsWith("/query");

describe("orderHasMilestones (idempotency guard)", () => {
  it("throws when the production-schedule database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(orderHasMilestones("order-page-1", client)).rejects.toThrow(
      /NOTION_PRODUCTION_SCHEDULE_DATABASE_ID is not configured/,
    );
  });

  it("filters by the Order relation containing the order page id", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) return jsonResponse({ results: [] });
      throw new Error(`unexpected path ${path}`);
    });

    await orderHasMilestones("order-page-1", client);

    const call = client.calls.find((c) => isQuery(c.path))!;
    expect(call.path).toBe("/v1/databases/test-db-id/query");
    const body = JSON.parse(call.init!.body as string);
    expect(body.filter).toEqual({
      property: PS_ORDER_RELATION_PROPERTY,
      relation: { contains: "order-page-1" },
    });
    expect(body.page_size).toBe(1);
  });

  it("returns true when a milestone already exists for the order", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({ results: [{ id: "existing-milestone" }] }),
    );
    expect(await orderHasMilestones("order-page-1", client)).toBe(true);
  });

  it("returns false when no milestone exists for the order", async () => {
    const client = makeFakeClient(() => jsonResponse({ results: [] }));
    expect(await orderHasMilestones("order-page-1", client)).toBe(false);
  });

  it("throws with the status when the query response is not ok", async () => {
    const client = makeFakeClient(() => errorResponse(500));
    await expect(orderHasMilestones("order-page-1", client)).rejects.toThrow(
      /Notion query failed with status 500/,
    );
  });
});

describe("listOrderMilestones (status read-back)", () => {
  const row = (stage: string | null, targetDate: string | null) => ({
    properties: {
      [PS_STAGE_PROPERTY]: { select: stage === null ? null : { name: stage } },
      [PS_TARGET_DATE_PROPERTY]: {
        date: targetDate === null ? null : { start: targetDate },
      },
    },
  });

  it("returns [] without querying when the database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({ results: [] }), "");
    expect(await listOrderMilestones("order-page-1", client)).toEqual([]);
    // Degrades silently — no fetch is attempted against an unconfigured db.
    expect(client.calls).toHaveLength(0);
  });

  it("filters by the Order relation and parses stage + target date from each row", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path))
        return jsonResponse({
          results: [
            row("Cutting/Pinning", "2026-08-01"),
            row("Delivery", "2026-08-10"),
          ],
        });
      throw new Error(`unexpected path ${path}`);
    });

    const result = await listOrderMilestones("order-page-1", client);

    const call = client.calls.find((c) => isQuery(c.path))!;
    expect(call.path).toBe("/v1/databases/test-db-id/query");
    expect(JSON.parse(call.init!.body as string).filter).toEqual({
      property: PS_ORDER_RELATION_PROPERTY,
      relation: { contains: "order-page-1" },
    });
    expect(result).toEqual([
      { stage: "Cutting/Pinning", targetDate: "2026-08-01" },
      { stage: "Delivery", targetDate: "2026-08-10" },
    ]);
  });

  it("skips rows missing a stage or a target date", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [
          row("Sewing/Construction", "2026-08-05"),
          row(null, "2026-08-06"),
          row("Delivery", null),
        ],
      }),
    );

    expect(await listOrderMilestones("order-page-1", client)).toEqual([
      { stage: "Sewing/Construction", targetDate: "2026-08-05" },
    ]);
  });

  it("returns [] (fail-soft) when the query response is not ok", async () => {
    const client = makeFakeClient(() => errorResponse(500));
    // A Production Schedule outage must not break the core status lookup.
    expect(await listOrderMilestones("order-page-1", client)).toEqual([]);
  });
});

describe("findMilestonesNeedingFittingReminder", () => {
  const reminderRow = (
    id: string,
    stage: string | null,
    targetDate: string | null,
    orderId: string | null,
    status: string | null = null,
  ) => ({
    id,
    properties: {
      [PS_STAGE_PROPERTY]: { select: stage === null ? null : { name: stage } },
      [PS_TARGET_DATE_PROPERTY]: {
        date: targetDate === null ? null : { start: targetDate },
      },
      [PS_ORDER_RELATION_PROPERTY]: {
        relation: orderId === null ? [] : [{ id: orderId }],
      },
      [PS_MILESTONE_STATUS_PROPERTY]: {
        formula: { type: "string", string: status },
      },
    },
  });

  it("returns [] without querying when the database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({ results: [] }), "");
    expect(
      await findMilestonesNeedingFittingReminder(
        { stages: ["Fitting"], onOrBefore: "2026-08-11" },
        client,
      ),
    ).toEqual([]);
    expect(client.calls).toHaveLength(0);
  });

  it("returns [] without querying when no stages are configured", async () => {
    const client = makeFakeClient(() => jsonResponse({ results: [] }));
    expect(
      await findMilestonesNeedingFittingReminder(
        { stages: [], onOrBefore: "2026-08-11" },
        client,
      ),
    ).toEqual([]);
    expect(client.calls).toHaveLength(0);
  });

  it("filters server-side only on stage(s) and not-yet-reminded (the reliably-typed properties)", async () => {
    // The completed / due / in-progress conditions are NOT filtered server-side:
    // they read the `Milestone Status` formula, whose *filter* type Notion often
    // can't resolve ("Unable to filter based on a formula of unknown type"). They
    // are evaluated client-side from each row's computed value instead.
    const client = makeFakeClient((path) => {
      if (isQuery(path)) return jsonResponse({ results: [] });
      throw new Error(`unexpected path ${path}`);
    });

    await findMilestonesNeedingFittingReminder(
      { stages: ["First Fitting", "Second Fitting"], onOrBefore: "2026-08-11" },
      client,
    );

    const call = client.calls.find((c) => isQuery(c.path))!;
    expect(call.path).toBe("/v1/databases/test-db-id/query");
    const body = JSON.parse(call.init!.body as string);
    expect(body.filter.and).toEqual([
      {
        or: [
          { property: PS_STAGE_PROPERTY, select: { equals: "First Fitting" } },
          { property: PS_STAGE_PROPERTY, select: { equals: "Second Fitting" } },
        ],
      },
      { property: PS_REMINDER_SENT_PROPERTY, checkbox: { equals: false } },
    ]);
    // No formula filter is sent — that's the whole point of the fix.
    const filterJson = JSON.stringify(body.filter);
    expect(filterJson).not.toContain("formula");
    expect(filterJson).not.toContain(PS_MILESTONE_STATUS_PROPERTY);
  });

  it("maps each row to page id, stage, target date, and linked order page id", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [
          reminderRow(
            "m-1",
            "Fitting",
            "2026-08-08",
            "order-1",
            MILESTONE_STATUS_IN_PROGRESS,
          ),
        ],
      }),
    );

    expect(
      await findMilestonesNeedingFittingReminder(
        { stages: ["Fitting"], onOrBefore: "2026-08-11" },
        client,
      ),
    ).toEqual([
      {
        pageId: "m-1",
        stage: "Fitting",
        targetDate: "2026-08-08",
        orderPageId: "order-1",
      },
    ]);
  });

  it("skips rows missing a stage, target date, or order relation", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [
          reminderRow("m-1", "Fitting", "2026-08-08", "order-1"),
          reminderRow("m-2", null, "2026-08-08", "order-2"),
          reminderRow("m-3", "Fitting", null, "order-3"),
          reminderRow("m-4", "Fitting", "2026-08-08", null),
        ],
      }),
    );

    expect(
      await findMilestonesNeedingFittingReminder(
        { stages: ["Fitting"], onOrBefore: "2026-08-11" },
        client,
      ),
    ).toEqual([
      {
        pageId: "m-1",
        stage: "Fitting",
        targetDate: "2026-08-08",
        orderPageId: "order-1",
      },
    ]);
  });

  it("excludes a completed milestone even when its date is within the cutoff", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [
          reminderRow(
            "m-1",
            "Fitting",
            "2026-08-08",
            "order-1",
            MILESTONE_STATUS_COMPLETED,
          ),
        ],
      }),
    );

    expect(
      await findMilestonesNeedingFittingReminder(
        { stages: ["Fitting"], onOrBefore: "2026-08-11" },
        client,
      ),
    ).toEqual([]);
  });

  it("includes an ahead-of-schedule milestone (In Progress) whose date is past the cutoff", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [
          // Target date is AFTER the cutoff, so date alone wouldn't qualify — but
          // the order has already reached the fitting stage.
          reminderRow(
            "m-1",
            "Fitting",
            "2026-09-01",
            "order-1",
            MILESTONE_STATUS_IN_PROGRESS,
          ),
        ],
      }),
    );

    expect(
      await findMilestonesNeedingFittingReminder(
        { stages: ["Fitting"], onOrBefore: "2026-08-11" },
        client,
      ),
    ).toEqual([
      {
        pageId: "m-1",
        stage: "Fitting",
        targetDate: "2026-09-01",
        orderPageId: "order-1",
      },
    ]);
  });

  it("excludes a not-yet-reached milestone whose date is still past the cutoff", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [
          reminderRow("m-1", "Fitting", "2026-09-01", "order-1", "Not Started"),
        ],
      }),
    );

    expect(
      await findMilestonesNeedingFittingReminder(
        { stages: ["Fitting"], onOrBefore: "2026-08-11" },
        client,
      ),
    ).toEqual([]);
  });

  it("still reminds by date when the Milestone Status value is unreadable (degraded formula)", async () => {
    // If the derived formula is unconfigured/broken its value comes back null; a
    // due-by-date fitting still gets its reminder rather than the whole pass dying.
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [reminderRow("m-1", "Fitting", "2026-08-08", "order-1", null)],
      }),
    );

    expect(
      await findMilestonesNeedingFittingReminder(
        { stages: ["Fitting"], onOrBefore: "2026-08-11" },
        client,
      ),
    ).toEqual([
      {
        pageId: "m-1",
        stage: "Fitting",
        targetDate: "2026-08-08",
        orderPageId: "order-1",
      },
    ]);
  });

  it("throws with the status and Notion error text when the query response is not ok", async () => {
    const client = makeFakeClient(() =>
      errorResponse(500, "internal_error: boom"),
    );
    await expect(
      findMilestonesNeedingFittingReminder(
        { stages: ["Fitting"], onOrBefore: "2026-08-11" },
        client,
      ),
    ).rejects.toThrow(/status 500: internal_error: boom/);
  });

  it("degrades to [] (fail-soft) when the Reminder Sent property is missing", async () => {
    // Notion's 400 when a filter references a property the atelier hasn't added
    // yet — the fitting-reminder feature's optional one-time setup step. Treated
    // as "not configured", not an incident, so the nightly cron doesn't alert.
    const client = makeFakeClient(() =>
      errorResponse(
        400,
        JSON.stringify({
          object: "error",
          status: 400,
          code: "validation_error",
          message:
            "Could not find property with name or id: Reminder Sent. Make sure the relation exists.",
        }),
      ),
    );
    expect(
      await findMilestonesNeedingFittingReminder(
        { stages: ["Fitting"], onOrBefore: "2026-08-11" },
        client,
      ),
    ).toEqual([]);
  });

  it("still throws on an unrelated 400 (not the missing-property case)", async () => {
    const client = makeFakeClient(() =>
      errorResponse(400, "validation_error: body failed validation"),
    );
    await expect(
      findMilestonesNeedingFittingReminder(
        { stages: ["Fitting"], onOrBefore: "2026-08-11" },
        client,
      ),
    ).rejects.toThrow(/status 400/);
  });
});

describe("markFittingReminderSent", () => {
  it("throws when the production-schedule database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(markFittingReminderSent("m-1", client)).rejects.toThrow(
      /NOTION_PRODUCTION_SCHEDULE_DATABASE_ID is not configured/,
    );
  });

  it("PATCHes the milestone page with only the Reminder Sent checkbox", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages/m-1") return jsonResponse({ id: "m-1" });
      throw new Error(`unexpected path ${path}`);
    });

    await markFittingReminderSent("m-1", client);

    expect(client.calls).toHaveLength(1);
    const call = client.calls[0];
    expect(call.path).toBe("/v1/pages/m-1");
    expect(call.init?.method).toBe("PATCH");
    const body = JSON.parse(call.init!.body as string);
    expect(body.properties).toEqual({
      [PS_REMINDER_SENT_PROPERTY]: { checkbox: true },
    });
  });

  it("throws with the status and Notion error text on a non-ok response", async () => {
    const client = makeFakeClient(() =>
      errorResponse(400, "validation_error: bad property"),
    );
    await expect(markFittingReminderSent("m-1", client)).rejects.toThrow(
      /status 400: validation_error: bad property/,
    );
  });
});

describe("createMilestone", () => {
  it("throws when the production-schedule database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(createMilestone(milestone, client)).rejects.toThrow(
      /NOTION_PRODUCTION_SCHEDULE_DATABASE_ID is not configured/,
    );
  });

  it("POSTs a page parented to the production-schedule database with milestone properties", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages") return jsonResponse({ id: "new-milestone" });
      throw new Error(`unexpected path ${path}`);
    });

    await createMilestone(milestone, client);

    expect(client.calls).toHaveLength(1);
    const call = client.calls[0];
    expect(call.path).toBe("/v1/pages");
    expect(call.init?.method).toBe("POST");
    const body = JSON.parse(call.init!.body as string);
    expect(body.parent).toEqual({ database_id: "test-db-id" });
    expect(body.properties[PS_ORDER_RELATION_PROPERTY]).toEqual({
      relation: [{ id: "order-page-1" }],
    });
  });

  it("throws with the status and Notion error text on a non-ok response", async () => {
    const client = makeFakeClient(() =>
      errorResponse(400, "validation_error: bad property"),
    );
    await expect(createMilestone(milestone, client)).rejects.toThrow(
      /status 400: validation_error: bad property/,
    );
  });
});
