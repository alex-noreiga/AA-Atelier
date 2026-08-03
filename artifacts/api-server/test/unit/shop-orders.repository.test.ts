import { describe, it, expect, beforeEach, vi } from "vitest";
import type Stripe from "stripe";
import {
  findOrderBySessionId,
  createShopOrder,
  findShopOrderByNumber,
  findShopOrdersByNumbers,
  findShopOrderForCancellation,
  setShopOrderCancelled,
  findShopOrderVerification,
} from "../../src/lib/notion/shop-orders.repository.js";
import {
  SHOP_ORDER_SESSION_PROPERTY,
  SHOP_ORDER_NUMBER_PROPERTY,
  SHOP_ORDER_STATUS_PROPERTY,
  SHOP_ORDER_TOTAL_PROPERTY,
  SHOP_ORDER_EMAIL_PROPERTY,
  SHOP_ORDER_CANCELLED_PROPERTY,
} from "../../src/lib/notion/shop-orders.blocks.js";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
} from "../support/fake-notion.js";

/** A Notion query result page carrying the number/status/total we read back. */
function shopOrderResultPage(opts: {
  orderNumber?: string;
  status?: string;
  total?: number | null;
  email?: string;
  sessionId?: string;
  cancelled?: boolean;
}) {
  return {
    id: "so-page",
    properties: {
      [SHOP_ORDER_NUMBER_PROPERTY]: {
        type: "rich_text",
        rich_text: opts.orderNumber ? [{ plain_text: opts.orderNumber }] : [],
      },
      [SHOP_ORDER_STATUS_PROPERTY]: {
        type: "status",
        status: opts.status ? { name: opts.status } : null,
      },
      [SHOP_ORDER_TOTAL_PROPERTY]: {
        type: "number",
        number: opts.total ?? null,
      },
      [SHOP_ORDER_EMAIL_PROPERTY]: {
        type: "email",
        email: opts.email ?? null,
      },
      [SHOP_ORDER_SESSION_PROPERTY]: {
        type: "rich_text",
        rich_text: opts.sessionId ? [{ plain_text: opts.sessionId }] : [],
      },
      [SHOP_ORDER_CANCELLED_PROPERTY]: {
        type: "checkbox",
        checkbox: opts.cancelled ?? false,
      },
    },
  };
}

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

describe("findShopOrderByNumber", () => {
  it("returns null for a blank order number without querying", async () => {
    const client = makeFakeClient(() => jsonResponse({ results: [] }));
    expect(await findShopOrderByNumber("  ", client)).toBeNull();
    expect(client.calls).toHaveLength(0);
  });

  it("filters by the order number as a rich_text equals and maps the page", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) {
        return jsonResponse({
          results: [
            shopOrderResultPage({
              orderNumber: "SHP-ABC-1234",
              status: "Processing",
              total: 44,
            }),
          ],
        });
      }
      throw new Error(`unexpected path ${path}`);
    });

    const order = await findShopOrderByNumber("shp-abc-1234", client);

    const body = JSON.parse(client.calls[0].init!.body as string);
    expect(body.filter).toEqual({
      property: SHOP_ORDER_NUMBER_PROPERTY,
      rich_text: { equals: "shp-abc-1234" },
    });
    expect(order).toEqual({
      orderNumber: "SHP-ABC-1234",
      status: "Processing",
      total: 44,
    });
  });

  it("returns null when no order matches", async () => {
    const client = makeFakeClient(() => jsonResponse({ results: [] }));
    expect(await findShopOrderByNumber("SHP-NONE", client)).toBeNull();
  });

  it("surfaces the cancelled flag when the order is cancelled", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [
          shopOrderResultPage({
            orderNumber: "SHP-1",
            status: "Cancelled",
            cancelled: true,
          }),
        ],
      }),
    );
    const order = await findShopOrderByNumber("SHP-1", client);
    expect(order?.cancelled).toBe(true);
  });
});

describe("findShopOrderForCancellation", () => {
  it("returns null for a blank order number without querying", async () => {
    const client = makeFakeClient(() => jsonResponse({ results: [] }));
    expect(await findShopOrderForCancellation("  ", client)).toBeNull();
    expect(client.calls).toHaveLength(0);
  });

  it("returns the page id, email, session id, status, and cancelled flag", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) {
        return jsonResponse({
          results: [
            shopOrderResultPage({
              orderNumber: "SHP-1",
              status: "Payment Confirmed",
              email: "ada@example.com",
              sessionId: "cs_1",
            }),
          ],
        });
      }
      throw new Error(`unexpected path ${path}`);
    });

    const order = await findShopOrderForCancellation("SHP-1", client);
    expect(order).toEqual({
      pageId: "so-page",
      orderNumber: "SHP-1",
      email: "ada@example.com",
      sessionId: "cs_1",
      status: "Payment Confirmed",
      cancelled: false,
    });
  });

  it("returns null when no order matches", async () => {
    const client = makeFakeClient(() => jsonResponse({ results: [] }));
    expect(await findShopOrderForCancellation("SHP-NONE", client)).toBeNull();
  });
});

describe("setShopOrderCancelled", () => {
  it("PATCHes the page with the Cancelled checkbox set", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages/so-page") return jsonResponse({}, 200);
      throw new Error(`unexpected path ${path}`);
    });

    await setShopOrderCancelled("so-page", client);

    const call = client.calls[0];
    expect(call.path).toBe("/v1/pages/so-page");
    expect(call.init?.method).toBe("PATCH");
    const body = JSON.parse(call.init!.body as string);
    expect(body.properties[SHOP_ORDER_CANCELLED_PROPERTY]).toEqual({
      checkbox: true,
    });
  });

  it("throws with the status on a non-ok response", async () => {
    const client = makeFakeClient(() => errorResponse(400, "bad"));
    await expect(setShopOrderCancelled("so-page", client)).rejects.toThrow(
      /status 400/,
    );
  });
});

describe("findShopOrderVerification", () => {
  /** A result page that also carries the Customer Email property. */
  function pageWithEmail(orderNumber: string, email: string | null) {
    const page = shopOrderResultPage({ orderNumber }) as any;
    page.properties[SHOP_ORDER_EMAIL_PROPERTY] = { type: "email", email };
    return page;
  }

  it("returns null for a blank order number without querying", async () => {
    const client = makeFakeClient(() => jsonResponse({ results: [] }));
    expect(await findShopOrderVerification("  ", client)).toBeNull();
    expect(client.calls).toHaveLength(0);
  });

  it("filters by the order number as a rich_text equals and returns the email", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) {
        return jsonResponse({
          results: [pageWithEmail("SHP-ABC-1234", "grace@example.com")],
        });
      }
      throw new Error(`unexpected path ${path}`);
    });

    const result = await findShopOrderVerification("shp-abc-1234", client);

    const body = JSON.parse(client.calls[0].init!.body as string);
    expect(body.filter).toEqual({
      property: SHOP_ORDER_NUMBER_PROPERTY,
      rich_text: { equals: "shp-abc-1234" },
    });
    expect(result).toEqual({ email: "grace@example.com" });
  });

  it("returns an empty email for a legacy order with none stored", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({ results: [pageWithEmail("SHP-OLD", null)] }),
    );
    expect(await findShopOrderVerification("SHP-OLD", client)).toEqual({
      email: "",
    });
  });

  it("returns null when no order matches", async () => {
    const client = makeFakeClient(() => jsonResponse({ results: [] }));
    expect(await findShopOrderVerification("SHP-NONE", client)).toBeNull();
  });
});

describe("fetchLiveShopOrderStatuses", () => {
  // Module-level TTL cache — re-import fresh per test to start clean.
  let repo: typeof import("../../src/lib/notion/shop-orders.repository.js");
  beforeEach(async () => {
    vi.resetModules();
    repo = await import("../../src/lib/notion/shop-orders.repository.js");
  });

  const isSchema = (path: string) => /\/v1\/databases\/[^/]+$/.test(path);

  it("reads the live Status workflow options from the database schema", async () => {
    const client = makeFakeClient((path) => {
      if (isSchema(path)) {
        return jsonResponse({
          properties: {
            [SHOP_ORDER_STATUS_PROPERTY]: {
              type: "status",
              status: {
                options: [
                  { name: "Payment Confirmed" },
                  { name: "Processing" },
                  { name: "Shipped" },
                ],
              },
            },
          },
        });
      }
      throw new Error(`unexpected path ${path}`);
    });

    expect(await repo.fetchLiveShopOrderStatuses(client)).toEqual([
      "Payment Confirmed",
      "Processing",
      "Shipped",
    ]);
  });
});

describe("findShopOrdersByNumbers", () => {
  const isQ = (p: string) => p.endsWith("/query");

  it("returns [] without querying for an empty list", async () => {
    const client = makeFakeClient(() => {
      throw new Error("should not fetch");
    });
    expect(await findShopOrdersByNumbers([], client)).toEqual([]);
    expect(client.calls).toHaveLength(0);
  });

  it("fetches by an OR filter and preserves the input order", async () => {
    const client = makeFakeClient((path) => {
      if (isQ(path)) {
        return jsonResponse({
          results: [
            shopOrderResultPage({
              orderNumber: "SHP-1",
              status: "Processing",
              total: 20,
            }),
            shopOrderResultPage({
              orderNumber: "SHP-2",
              status: "Shipped",
              total: 30,
            }),
          ],
        });
      }
      throw new Error(`unexpected path ${path}`);
    });

    const result = await findShopOrdersByNumbers(["SHP-2", "SHP-1"], client);

    expect(result.map((o) => o.orderNumber)).toEqual(["SHP-2", "SHP-1"]);
    const body = JSON.parse(client.calls[0].init!.body as string);
    expect(body.filter.or).toEqual([
      { property: "Order Number", rich_text: { equals: "SHP-2" } },
      { property: "Order Number", rich_text: { equals: "SHP-1" } },
    ]);
  });
});
