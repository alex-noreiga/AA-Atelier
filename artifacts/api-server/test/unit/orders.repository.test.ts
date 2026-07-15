import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createOrderInput } from "@workspace/test-fixtures";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
  databaseSchemaWithStages,
  orderPage,
  type FakeNotionClient,
} from "../support/fake-notion.js";
import type { CreateOrderInput } from "../../src/lib/notion/orders.schema.js";

// The repository keeps a module-level TTL cache for the live stage list, so each
// test imports a fresh copy of the module to start from a clean cache.
let repo: typeof import("../../src/lib/notion/orders.repository.js");

beforeEach(async () => {
  vi.resetModules();
  repo = await import("../../src/lib/notion/orders.repository.js");
});

const validOrder: CreateOrderInput = createOrderInput();

const isQuery = (path: string) => path.endsWith("/query");
const isSchema = (path: string) => /\/v1\/databases\/[^/]+$/.test(path);

describe("createOrder", () => {
  it("throws when the database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(repo.createOrder(validOrder, client)).rejects.toThrow(
      /NOTION_ORDERS_DATABASE_ID is not configured/,
    );
  });

  it("POSTs a page and returns an ORD- order number", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages") return jsonResponse({ id: "new-page" }, 200);
      throw new Error(`unexpected path ${path}`);
    });

    const orderNumber = await repo.createOrder(validOrder, client);

    expect(orderNumber).toMatch(/^ORD-[A-Z0-9]+-[A-Z0-9]+$/);
    expect(client.calls).toHaveLength(1);
    const call = client.calls[0];
    expect(call.path).toBe("/v1/pages");
    expect(call.init?.method).toBe("POST");
    const body = JSON.parse(call.init!.body as string);
    expect(body.parent).toEqual({ database_id: "test-db-id" });
    // The generated number is embedded in the page properties.
    expect(body.properties["Order Number"].rich_text[0].text.content).toBe(
      orderNumber,
    );
    expect(Array.isArray(body.children)).toBe(true);
  });

  it("writes the Client relation when a client page id is provided", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages") return jsonResponse({ id: "new-page" }, 200);
      throw new Error(`unexpected path ${path}`);
    });

    await repo.createOrder(validOrder, client, "client-9");

    const body = JSON.parse(client.calls[0].init!.body as string);
    expect(body.properties["Client"].relation).toEqual([{ id: "client-9" }]);
  });

  it("throws with status and the Notion error text on a non-ok response", async () => {
    const client = makeFakeClient(() =>
      errorResponse(400, "validation_error: bad property"),
    );
    await expect(repo.createOrder(validOrder, client)).rejects.toThrow(
      /status 400: validation_error: bad property/,
    );
  });
});

describe("findOrderByNumber", () => {
  it("returns null for an empty/whitespace number without calling Notion", async () => {
    const client = makeFakeClient(() => {
      throw new Error("should not fetch");
    });
    expect(await repo.findOrderByNumber("   ", client)).toBeNull();
    expect(client.calls).toHaveLength(0);
  });

  it("filters by trimmed rich_text equals and maps the found page", async () => {
    const client = makeFakeClient((path) => {
      if (isSchema(path)) {
        return jsonResponse(
          databaseSchemaWithStages(["Consultation", "Sewing", "Delivery"]),
        );
      }
      if (isQuery(path)) {
        return jsonResponse({
          results: [
            orderPage({
              orderName: "Ada – Custom Dress",
              currentStage: "Sewing",
            }),
          ],
        });
      }
      throw new Error(`unexpected path ${path}`);
    });

    const record = await repo.findOrderByNumber("  000002  ", client);

    expect(record).toEqual({
      orderNumber: "000002",
      orderName: "Ada – Custom Dress",
      currentStage: "Sewing",
      stages: ["Consultation", "Sewing", "Delivery"],
      depositPaid: false,
      deposit2Paid: false,
      pageId: "page-id",
    });

    const queryCall = client.calls.find((c) => isQuery(c.path))!;
    const filter = JSON.parse(queryCall.init!.body as string).filter;
    expect(filter).toEqual({
      property: "Order Number",
      rich_text: { equals: "000002" },
    });
  });

  it("returns null when the query yields no results", async () => {
    const client = makeFakeClient((path) => {
      if (isSchema(path)) return jsonResponse(databaseSchemaWithStages([]));
      return jsonResponse({ results: [] });
    });
    expect(await repo.findOrderByNumber("ORD-NOPE", client)).toBeNull();
  });

  it("throws when the query response is not ok", async () => {
    const client = makeFakeClient((path) => {
      if (isSchema(path)) return jsonResponse(databaseSchemaWithStages([]));
      return errorResponse(500);
    });
    await expect(repo.findOrderByNumber("ORD-1", client)).rejects.toThrow(
      /Notion query failed with status 500/,
    );
  });
});

describe("deposit lookups & updates", () => {
  it("maps the deposit amount and paid flag onto the found order", async () => {
    const client = makeFakeClient((path) => {
      if (isSchema(path)) return jsonResponse(databaseSchemaWithStages(["A"]));
      if (isQuery(path)) {
        return jsonResponse({
          results: [
            orderPage({
              orderName: "Ada",
              currentStage: "A",
              depositAmount: 150,
              depositPaid: true,
            }),
          ],
        });
      }
      throw new Error(`unexpected ${path}`);
    });

    const record = await repo.findOrderByNumber("ORD-1", client);
    expect(record?.depositAmount).toBe(150);
    expect(record?.depositPaid).toBe(true);
  });

  it("maps the second deposit and the linked invoice page id", async () => {
    const client = makeFakeClient((path) => {
      if (isSchema(path)) return jsonResponse(databaseSchemaWithStages(["A"]));
      if (isQuery(path)) {
        return jsonResponse({
          results: [
            orderPage({
              id: "order-9",
              orderName: "Ada",
              currentStage: "A",
              deposit2Amount: 300,
              deposit2Paid: true,
              invoicePageId: "inv-7",
            }),
          ],
        });
      }
      throw new Error(`unexpected ${path}`);
    });

    const record = await repo.findOrderByNumber("ORD-1", client);
    expect(record?.pageId).toBe("order-9");
    expect(record?.deposit2Amount).toBe(300);
    expect(record?.deposit2Paid).toBe(true);
    expect(record?.invoicePageId).toBe("inv-7");
  });

  it("findDepositTarget returns the page id and deposit state, no schema fetch", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) {
        return jsonResponse({
          results: [
            orderPage({
              id: "page-42",
              orderName: "Ada",
              depositAmount: 200,
              depositPaid: false,
            }),
          ],
        });
      }
      throw new Error(`unexpected ${path}`);
    });

    const target = await repo.findDepositTarget("ORD-1", client);
    expect(target).toEqual({
      pageId: "page-42",
      orderName: "Ada",
      depositAmount: 200,
      depositPaid: false,
    });
    // The deposit lookup doesn't need the live stage list.
    expect(client.calls.every((c) => isQuery(c.path))).toBe(true);
  });

  it("findDepositTarget returns null when no order matches", async () => {
    const client = makeFakeClient(() => jsonResponse({ results: [] }));
    expect(await repo.findDepositTarget("ORD-NOPE", client)).toBeNull();
  });

  it("markDepositPaid PATCHes the page with the checkbox and session id", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages/page-42") return jsonResponse({ id: "page-42" });
      throw new Error(`unexpected ${path}`);
    });

    await repo.markDepositPaid("page-42", "cs_test_1", client);

    const call = client.calls[0];
    expect(call.path).toBe("/v1/pages/page-42");
    expect(call.init?.method).toBe("PATCH");
    const body = JSON.parse(call.init!.body as string);
    expect(body.properties["Deposit Paid"]).toEqual({ checkbox: true });
    expect(
      body.properties["Deposit Session Id"].rich_text[0].text.content,
    ).toBe("cs_test_1");
  });

  it("markDepositPaid throws on a non-ok response", async () => {
    const client = makeFakeClient(() => errorResponse(400, "bad"));
    await expect(
      repo.markDepositPaid("page-42", "cs_1", client),
    ).rejects.toThrow(/status 400: bad/);
  });
});

describe("findOrderForMeasurementChange", () => {
  it("returns null for an empty/whitespace number without calling Notion", async () => {
    const client = makeFakeClient(() => {
      throw new Error("should not fetch");
    });
    expect(await repo.findOrderForMeasurementChange("   ", client)).toBeNull();
    expect(client.calls).toHaveLength(0);
  });

  it("reads the email, current stage, and live stage list off the found page", async () => {
    const client = makeFakeClient((path) => {
      if (isSchema(path)) {
        return jsonResponse(
          databaseSchemaWithStages(["Consultation", "Sewing", "Delivery"]),
        );
      }
      if (isQuery(path)) {
        return jsonResponse({
          results: [
            orderPage({
              orderName: "Ada – Custom Dress",
              currentStage: "Consultation",
              email: "ada@example.com",
            }),
          ],
        });
      }
      throw new Error(`unexpected path ${path}`);
    });

    const verification = await repo.findOrderForMeasurementChange(
      "  000002  ",
      client,
    );

    expect(verification).toEqual({
      email: "ada@example.com",
      currentStage: "Consultation",
      stages: ["Consultation", "Sewing", "Delivery"],
    });
  });

  it("returns an empty email for a legacy order with no Email property value", async () => {
    const client = makeFakeClient((path) => {
      if (isSchema(path)) return jsonResponse(databaseSchemaWithStages(["A"]));
      return jsonResponse({
        results: [orderPage({ currentStage: "A", email: null })],
      });
    });

    const verification = await repo.findOrderForMeasurementChange(
      "000002",
      client,
    );
    expect(verification?.email).toBe("");
  });

  it("returns null when the query yields no results", async () => {
    const client = makeFakeClient((path) => {
      if (isSchema(path)) return jsonResponse(databaseSchemaWithStages([]));
      return jsonResponse({ results: [] });
    });
    expect(
      await repo.findOrderForMeasurementChange("ORD-NOPE", client),
    ).toBeNull();
  });
});

describe("findOrdersNeedingMilestones", () => {
  it("filters on due-date-set AND milestones-not-generated, and attaches the live stage list", async () => {
    const client = makeFakeClient((path) => {
      if (isSchema(path)) {
        return jsonResponse(
          databaseSchemaWithStages(["Consultation", "Fitting", "Delivery"]),
        );
      }
      if (isQuery(path)) {
        return jsonResponse({
          results: [
            orderPage({
              id: "page-1",
              orderNumber: "000002",
              orderName: "Ada – Custom Dress",
              currentStage: "Fitting",
              dueDate: "2026-09-01",
            }),
          ],
        });
      }
      throw new Error(`unexpected path ${path}`);
    });

    const orders = await repo.findOrdersNeedingMilestones(client);

    expect(orders).toEqual([
      {
        pageId: "page-1",
        orderNumber: "000002",
        orderName: "Ada – Custom Dress",
        currentStage: "Fitting",
        dueDate: "2026-09-01",
        stages: ["Consultation", "Fitting", "Delivery"],
      },
    ]);

    const queryCall = client.calls.find((c) => isQuery(c.path))!;
    const filter = JSON.parse(queryCall.init!.body as string).filter;
    expect(filter).toEqual({
      and: [
        { property: "Due Date", date: { is_not_empty: true } },
        { property: "Milestones Generated", checkbox: { equals: false } },
      ],
    });
  });

  it("skips a page whose due date is somehow empty", async () => {
    const client = makeFakeClient((path) => {
      if (isSchema(path)) return jsonResponse(databaseSchemaWithStages(["A"]));
      return jsonResponse({
        results: [orderPage({ currentStage: "A", dueDate: null })],
      });
    });
    expect(await repo.findOrdersNeedingMilestones(client)).toEqual([]);
  });

  it("throws when the query response is not ok", async () => {
    const client = makeFakeClient((path) => {
      if (isSchema(path)) return jsonResponse(databaseSchemaWithStages([]));
      return errorResponse(500);
    });
    await expect(repo.findOrdersNeedingMilestones(client)).rejects.toThrow(
      /Notion query failed with status 500/,
    );
  });
});

describe("markMilestonesGenerated", () => {
  it("PATCHes the order page with the checkbox set", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages/page-1") return jsonResponse({ id: "page-1" });
      throw new Error(`unexpected ${path}`);
    });

    await repo.markMilestonesGenerated("page-1", client);

    const call = client.calls[0];
    expect(call.path).toBe("/v1/pages/page-1");
    expect(call.init?.method).toBe("PATCH");
    const body = JSON.parse(call.init!.body as string);
    expect(body.properties["Milestones Generated"]).toEqual({ checkbox: true });
  });

  it("throws on a non-ok response", async () => {
    const client = makeFakeClient(() => errorResponse(400, "bad"));
    await expect(
      repo.markMilestonesGenerated("page-1", client),
    ).rejects.toThrow(/status 400: bad/);
  });
});

describe("fetchLiveOrderStages caching (through findOrderByNumber)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function countingClient(stages: string[]): FakeNotionClient {
    return makeFakeClient((path) => {
      if (isSchema(path)) return jsonResponse(databaseSchemaWithStages(stages));
      return jsonResponse({ results: [] });
    });
  }

  it("caches the schema for the 60s TTL, then refetches", async () => {
    const client = countingClient(["A", "B"]);

    await repo.findOrderByNumber("ORD-1", client);
    await repo.findOrderByNumber("ORD-2", client); // within TTL → cached
    let schemaFetches = client.calls.filter((c) => isSchema(c.path)).length;
    expect(schemaFetches).toBe(1);

    vi.advanceTimersByTime(61_000); // past the 60s TTL
    await repo.findOrderByNumber("ORD-3", client);
    schemaFetches = client.calls.filter((c) => isSchema(c.path)).length;
    expect(schemaFetches).toBe(2);
  });

  it("falls back to the cached stages when a later schema fetch fails", async () => {
    let failSchema = false;
    const client = makeFakeClient((path) => {
      if (isSchema(path)) {
        return failSchema
          ? errorResponse(503)
          : jsonResponse(databaseSchemaWithStages(["A", "B"]));
      }
      return jsonResponse({
        results: [orderPage({ orderName: "X", currentStage: "A" })],
      });
    });

    // Warm the cache.
    const first = await repo.findOrderByNumber("ORD-1", client);
    expect(first?.stages).toEqual(["A", "B"]);

    // Now the schema endpoint fails, but the cache is still fresh enough to use
    // after TTL expiry — advance past TTL and force the failure path.
    failSchema = true;
    vi.advanceTimersByTime(61_000);
    const second = await repo.findOrderByNumber("ORD-2", client);
    expect(second?.stages).toEqual(["A", "B"]); // served from cache, not thrown
  });

  it("throws when the schema fetch fails and there is no cache", async () => {
    const client = makeFakeClient((path) => {
      if (isSchema(path)) return errorResponse(503);
      return jsonResponse({ results: [] });
    });
    await expect(repo.findOrderByNumber("ORD-1", client)).rejects.toThrow(
      /database schema fetch failed with status 503/,
    );
  });
});
