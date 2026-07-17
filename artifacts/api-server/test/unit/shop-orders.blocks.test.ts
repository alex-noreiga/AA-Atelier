import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import {
  buildShopOrderProperties,
  buildShopOrderPageBlocks,
  formatShippingAddress,
  generateShopOrderNumber,
  SHOP_ORDER_TITLE_PROPERTY,
  SHOP_ORDER_NUMBER_PROPERTY,
  SHOP_ORDER_SESSION_PROPERTY,
  SHOP_ORDER_EMAIL_PROPERTY,
  SHOP_ORDER_NAME_PROPERTY,
  SHOP_ORDER_TOTAL_PROPERTY,
  SHOP_ORDER_STATUS_PROPERTY,
  SHOP_ORDER_SHIPPING_PROPERTY,
  SHOP_ORDER_CLIENT_PROPERTY,
} from "../../src/lib/notion/shop-orders.blocks.js";

function session(
  overrides: Record<string, unknown> = {},
): Stripe.Checkout.Session {
  return {
    id: "cs_test_123",
    amount_total: 4400,
    currency: "usd",
    customer_details: {
      email: "ada@example.com",
      name: "Ada Lovelace",
      address: null,
    },
    collected_information: {
      shipping_details: {
        address: {
          line1: "1 Analytical Ave",
          line2: null,
          city: "London",
          state: null,
          postal_code: "EC1",
          country: "GB",
        },
      },
    },
    line_items: {
      data: [
        { description: "Bow Fleece Soaker", quantity: 2, amount_total: 4400 },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

describe("buildShopOrderProperties", () => {
  it("maps a paid session to Notion properties, converting cents to dollars", () => {
    const props = buildShopOrderProperties(session()) as Record<string, any>;

    expect(props[SHOP_ORDER_TITLE_PROPERTY].title[0].text.content).toBe(
      "Shop order — Ada Lovelace",
    );
    expect(props[SHOP_ORDER_SESSION_PROPERTY].rich_text[0].text.content).toBe(
      "cs_test_123",
    );
    expect(props[SHOP_ORDER_EMAIL_PROPERTY]).toEqual({
      email: "ada@example.com",
    });
    expect(props[SHOP_ORDER_NAME_PROPERTY].rich_text[0].text.content).toBe(
      "Ada Lovelace",
    );
    expect(props[SHOP_ORDER_TOTAL_PROPERTY]).toEqual({ number: 44 });
    expect(props[SHOP_ORDER_STATUS_PROPERTY]).toEqual({
      status: { name: "Payment Confirmed" },
    });
    expect(props[SHOP_ORDER_SHIPPING_PROPERTY].rich_text[0].text.content).toBe(
      "1 Analytical Ave, London EC1, GB",
    );
  });

  it("writes the order number (from session metadata) and puts it in the title", () => {
    const props = buildShopOrderProperties(
      session({ metadata: { kind: "shop", orderNumber: "SHP-ABC-1234" } }),
    ) as Record<string, any>;

    expect(props[SHOP_ORDER_NUMBER_PROPERTY].rich_text[0].text.content).toBe(
      "SHP-ABC-1234",
    );
    expect(props[SHOP_ORDER_TITLE_PROPERTY].title[0].text.content).toBe(
      "Shop order SHP-ABC-1234 — Ada Lovelace",
    );
  });

  it("omits the order-number property when the session carries no metadata", () => {
    const props = buildShopOrderProperties(session()) as Record<
      string,
      unknown
    >;
    expect(props[SHOP_ORDER_NUMBER_PROPERTY]).toBeUndefined();
  });

  it("links to the Client CRM record when a client page id is given", () => {
    const props = buildShopOrderProperties(session(), "client-9") as Record<
      string,
      any
    >;
    expect(props[SHOP_ORDER_CLIENT_PROPERTY]).toEqual({
      relation: [{ id: "client-9" }],
    });
  });

  it("omits the Client relation when no client page id is given", () => {
    const props = buildShopOrderProperties(session()) as Record<
      string,
      unknown
    >;
    expect(props[SHOP_ORDER_CLIENT_PROPERTY]).toBeUndefined();
  });

  it("omits optional properties (email, name, shipping) when Stripe didn't collect them", () => {
    const props = buildShopOrderProperties(
      session({ customer_details: null, collected_information: null }),
    ) as Record<string, unknown>;

    expect(props[SHOP_ORDER_EMAIL_PROPERTY]).toBeUndefined();
    expect(props[SHOP_ORDER_NAME_PROPERTY]).toBeUndefined();
    expect(props[SHOP_ORDER_SHIPPING_PROPERTY]).toBeUndefined();
    // The session id title fallback still names the order.
    expect(
      (props[SHOP_ORDER_TITLE_PROPERTY] as any).title[0].text.content,
    ).toBe("Shop order — cs_test_123");
  });
});

describe("buildShopOrderPageBlocks", () => {
  it("renders one bullet per line item with quantity and line total", () => {
    const blocks = buildShopOrderPageBlocks(session()) as any[];

    expect(blocks[0].type).toBe("heading_2");
    expect(blocks[1].type).toBe("bulleted_list_item");
    expect(blocks[1].bulleted_list_item.rich_text[0].text.content).toBe(
      "2 × Bow Fleece Soaker — $44.00",
    );
  });

  it("appends shipping and tax lines when they were charged", () => {
    const blocks = buildShopOrderPageBlocks(
      session({ total_details: { amount_shipping: 800, amount_tax: 340 } }),
    ) as any[];
    const texts = blocks.map(
      (b) => b.bulleted_list_item?.rich_text[0].text.content,
    );
    expect(texts).toContain("Shipping — $8.00");
    expect(texts).toContain("Tax — $3.40");
  });

  it("omits the shipping line when there was no shipping cost", () => {
    const blocks = buildShopOrderPageBlocks(session()) as any[];
    const texts = blocks.map(
      (b) => b.bulleted_list_item?.rich_text[0].text.content ?? "",
    );
    expect(texts.some((t: string) => t.startsWith("Shipping"))).toBe(false);
  });
});

describe("generateShopOrderNumber", () => {
  it("produces an uppercase SHP-prefixed order number", () => {
    const number = generateShopOrderNumber();
    expect(number).toMatch(/^SHP-[0-9A-Z]+-[0-9A-Z]{1,4}$/);
  });
});

describe("formatShippingAddress", () => {
  it("falls back to the legacy shipping_details field when collected_information is absent", () => {
    const s = session({
      collected_information: null,
      shipping_details: {
        address: {
          line1: "5 Main St",
          city: "Boston",
          state: "MA",
          postal_code: "02110",
          country: "US",
        },
      },
    });
    expect(formatShippingAddress(s)).toBe("5 Main St, Boston MA 02110, US");
  });

  it("returns null when no address was collected", () => {
    expect(
      formatShippingAddress(
        session({ collected_information: null, customer_details: null }),
      ),
    ).toBeNull();
  });
});
