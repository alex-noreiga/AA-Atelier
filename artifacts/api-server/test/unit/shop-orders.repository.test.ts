import { describe, it, expect } from "vitest";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
  shopOrderPage,
} from "../support/fake-notion.js";
import { findPaidShopOrderByEmail } from "../../src/lib/notion/shop-orders.repository.js";

const isQuery = (path: string) => path.endsWith("/query");

describe("findPaidShopOrderByEmail", () => {
  it("throws when the database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(
      findPaidShopOrderByEmail("ada@example.com", client),
    ).rejects.toThrow(/NOTION_SHOP_ORDERS_DATABASE_ID is not configured/);
  });

  it("returns null (without querying) for a blank email", async () => {
    const client = makeFakeClient(() => {
      throw new Error("should not query");
    });
    expect(await findPaidShopOrderByEmail("   ", client)).toBeNull();
    expect(client.calls).toHaveLength(0);
  });

  it("filters on the normalized email and returns the matched session id", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) {
        return jsonResponse({
          results: [shopOrderPage({ id: "so1", sessionId: "cs_test_abc" })],
        });
      }
      throw new Error(`unexpected path ${path}`);
    });

    const match = await findPaidShopOrderByEmail("  Ada@Example.com ", client);

    expect(match).toEqual({ sessionId: "cs_test_abc" });
    const body = JSON.parse(
      client.calls.find((c) => isQuery(c.path))!.init!.body as string,
    );
    expect(body.filter).toEqual({
      property: "Customer Email",
      email: { equals: "ada@example.com" },
    });
    expect(body.sorts).toEqual([
      { timestamp: "created_time", direction: "descending" },
    ]);
    expect(body.page_size).toBe(1);
  });

  it("returns null when no shop order matches the email", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) return jsonResponse({ results: [] });
      throw new Error(`unexpected path ${path}`);
    });
    expect(
      await findPaidShopOrderByEmail("nobody@example.com", client),
    ).toBeNull();
  });

  it("throws with the status when the query response is not ok", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) return errorResponse(500);
      throw new Error(`unexpected path ${path}`);
    });
    await expect(
      findPaidShopOrderByEmail("ada@example.com", client),
    ).rejects.toThrow(/Notion query failed with status 500/);
  });
});
