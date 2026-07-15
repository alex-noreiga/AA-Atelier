import { describe, it, expect } from "vitest";
import {
  createMilestone,
  orderHasMilestones,
} from "../../src/lib/notion/production-schedule.repository.js";
import {
  PS_ORDER_RELATION_PROPERTY,
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
  clientName: "Ada",
  stage: "Fitting",
  targetDate: "2026-08-15",
  dueDate: "2026-09-01",
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
