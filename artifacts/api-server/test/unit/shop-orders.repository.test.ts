import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import {
  findOrderBySessionId,
  createShopOrder,
} from "../../src/lib/notion/shop-orders.repository.js";
import { SHOP_ORDER_SESSION_PROPERTY } from "../../src/lib/notion/shop-orders.blocks.js";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
} from "../support/fake-notion.js";

// A minimal paid Checkout session — only the fields the block builder reads.
function session(
  overrides: Record<string, unknown> = {},
): Stripe.Checkout.Session {
  return {
    id: "cs_test_123",
    amount_total: 4400,
    currency: "usd",
    customer_details: { email: "ada@example.com", name: "Ada", address: null },
    line_items: {
      data: [{ description: "Bow Soaker", quantity: 1, amount_total: 4400 }],
    },
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

const isQuery = (path: string) => path.endsWith("/query");

describe("findOrderBySessionId (idempotency guard)", () => {
  it("throws when the shop-orders database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(findOrderBySessionId("cs_1", client)).rejects.toThrow(
      /NOTION_SHOP_ORDERS_DATABASE_ID is not configured/,
    );
  });

  it("filters by the Stripe session id as a rich_text equals", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) return jsonResponse({ results: [] });
      throw new Error(`unexpected path ${path}`);
    });

    await findOrderBySessionId("cs_test_123", client);

    const call = client.calls.find((c) => isQuery(c.path))!;
    expect(call.path).toBe("/v1/databases/test-db-id/query");
    expect(call.init?.method).toBe("POST");
    const body = JSON.parse(call.init!.body as string);
    expect(body.filter).toEqual({
      property: SHOP_ORDER_SESSION_PROPERTY,
      rich_text: { equals: "cs_test_123" },
    });
    // Only the first match matters for a presence check.
    expect(body.page_size).toBe(1);
  });

  it("returns true when a page already exists for the session (a replay)", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({ results: [{ id: "existing-page" }] }),
    );
    expect(await findOrderBySessionId("cs_test_123", client)).toBe(true);
  });

  it("returns false when no page exists for the session (first delivery)", async () => {
    const client = makeFakeClient(() => jsonResponse({ results: [] }));
    expect(await findOrderBySessionId("cs_test_123", client)).toBe(false);
  });

  it("throws with the status when the query response is not ok", async () => {
    const client = makeFakeClient(() => errorResponse(500));
    await expect(findOrderBySessionId("cs_1", client)).rejects.toThrow(
      /Notion query failed with status 500/,
    );
  });
});

describe("createShopOrder", () => {
  it("throws when the shop-orders database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(createShopOrder(session(), client)).rejects.toThrow(
      /NOTION_SHOP_ORDERS_DATABASE_ID is not configured/,
    );
  });

  it("POSTs a page parented to the shop-orders database with properties and body blocks", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages") return jsonResponse({ id: "new-page" }, 200);
      throw new Error(`unexpected path ${path}`);
    });

    await createShopOrder(session(), client);

    expect(client.calls).toHaveLength(1);
    const call = client.calls[0];
    expect(call.path).toBe("/v1/pages");
    expect(call.init?.method).toBe("POST");
    const body = JSON.parse(call.init!.body as string);
    expect(body.parent).toEqual({ database_id: "test-db-id" });
    // The session id is stored so a later delivery can be deduped against it.
    expect(
      body.properties[SHOP_ORDER_SESSION_PROPERTY].rich_text[0].text.content,
    ).toBe("cs_test_123");
    expect(Array.isArray(body.children)).toBe(true);
  });

  it("throws with the status and Notion error text on a non-ok response", async () => {
    const client = makeFakeClient(() =>
      errorResponse(400, "validation_error: bad property"),
    );
    await expect(createShopOrder(session(), client)).rejects.toThrow(
      /status 400: validation_error: bad property/,
    );
  });
});
