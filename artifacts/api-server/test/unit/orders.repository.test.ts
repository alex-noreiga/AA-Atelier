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
import type { CreateOrderInput } from "../../src/lib/notion/schema.js";

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
