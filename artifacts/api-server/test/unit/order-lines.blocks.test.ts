import { describe, it, expect } from "vitest";

import {
  buildOrderLineProperties,
  ORDER_LINE_TITLE_PROPERTY,
  ORDER_LINE_ITEM_PROPERTY,
  ORDER_LINE_ORDER_PROPERTY,
  ORDER_LINE_QTY_PROPERTY,
  ORDER_LINE_UNIT_PRICE_PROPERTY,
  ORDER_LINE_SIZE_PROPERTY,
} from "../../src/lib/notion/order-lines.blocks.js";

describe("buildOrderLineProperties", () => {
  it("writes the title, both relations, quantity and unit price", () => {
    const properties = buildOrderLineProperties({
      orderPageId: "order-page",
      itemPageId: "inventory-page",
      name: "Bow Fleece Soaker — Adult M",
      quantity: 2,
      unitPrice: 22.5,
      size: "Adult M",
    });

    expect(properties[ORDER_LINE_TITLE_PROPERTY]).toEqual({
      title: [{ text: { content: "Bow Fleece Soaker — Adult M" } }],
    });
    expect(properties[ORDER_LINE_ORDER_PROPERTY]).toEqual({
      relation: [{ id: "order-page" }],
    });
    expect(properties[ORDER_LINE_ITEM_PROPERTY]).toEqual({
      relation: [{ id: "inventory-page" }],
    });
    expect(properties[ORDER_LINE_QTY_PROPERTY]).toEqual({ number: 2 });
    expect(properties[ORDER_LINE_UNIT_PRICE_PROPERTY]).toEqual({
      number: 22.5,
    });
    expect(properties[ORDER_LINE_SIZE_PROPERTY]).toEqual({
      select: { name: "Adult M" },
    });
  });

  it("omits the size entirely for a one-size piece", () => {
    const properties = buildOrderLineProperties({
      orderPageId: "order-page",
      itemPageId: "inventory-page",
      name: "Blade Towel",
      quantity: 1,
      unitPrice: 12,
    });

    expect(properties).not.toHaveProperty(ORDER_LINE_SIZE_PROPERTY);
  });
});
