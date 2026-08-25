import { describe, it, expect } from "vitest";
import {
  extractConsignment,
  CONSIGNMENT_PLACEMENT_PROPERTY,
  CONSIGNMENT_ITEM_PROPERTY,
  CONSIGNMENT_DELIVERED_QTY_PROPERTY,
  CONSIGNMENT_RETURNED_QTY_PROPERTY,
  CONSIGNMENT_SOLD_QTY_PROPERTY,
  CONSIGNMENT_SETTLED_PROPERTY,
  CONSIGNMENT_SETTLED_ON_PROPERTY,
  CONSIGNMENT_DELIVERED_ON_PROPERTY,
  CONSIGNMENT_RETAIL_PRICE_PROPERTY,
  CONSIGNMENT_PAYOUT_PROPERTY,
  type NotionConsignmentPage,
} from "../../src/lib/notion/consignment.schema.js";

function page(
  properties: NotionConsignmentPage["properties"] = {},
): NotionConsignmentPage {
  return { id: "placement-1", properties };
}

describe("extractConsignment", () => {
  it("maps a fully-filled placement", () => {
    const record = extractConsignment(
      page({
        [CONSIGNMENT_PLACEMENT_PROPERTY]: {
          type: "title",
          title: [{ plain_text: "August drop " }, { plain_text: "— soakers" }],
        },
        [CONSIGNMENT_ITEM_PROPERTY]: {
          type: "relation",
          relation: [{ id: "inv-1" }],
        },
        [CONSIGNMENT_DELIVERED_QTY_PROPERTY]: { type: "number", number: 8 },
        [CONSIGNMENT_RETURNED_QTY_PROPERTY]: { type: "number", number: 2 },
        [CONSIGNMENT_SOLD_QTY_PROPERTY]: { type: "number", number: 5 },
        [CONSIGNMENT_SETTLED_PROPERTY]: { type: "checkbox", checkbox: true },
        [CONSIGNMENT_SETTLED_ON_PROPERTY]: {
          type: "date",
          date: { start: "2026-08-14" },
        },
        [CONSIGNMENT_DELIVERED_ON_PROPERTY]: {
          type: "date",
          date: { start: "2026-07-02" },
        },
        [CONSIGNMENT_RETAIL_PRICE_PROPERTY]: { type: "number", number: 35 },
        [CONSIGNMENT_PAYOUT_PROPERTY]: {
          type: "formula",
          formula: { number: 87.5 },
        },
      }),
    );

    expect(record).toEqual({
      id: "placement-1",
      placement: "August drop — soakers",
      itemId: "inv-1",
      delivered: 8,
      returned: 2,
      sold: 5,
      settled: true,
      settledOn: "2026-08-14",
      deliveredOn: "2026-07-02",
      retailPrice: 35,
      payout: 87.5,
    });
  });

  it("reads an absent quantity as unknown, never as zero", () => {
    // `Qty Sold` is blank until settlement by design, so reading it as zero
    // would report the whole shelf as still sitting there.
    const record = extractConsignment(
      page({
        [CONSIGNMENT_DELIVERED_QTY_PROPERTY]: { type: "number", number: 4 },
      }),
    );

    expect(record.delivered).toBe(4);
    expect(record.sold).toBeNull();
    expect(record.returned).toBeNull();
    expect(record.retailPrice).toBeNull();
  });

  it("reads a payout formula that produced no number as unclaimed", () => {
    const record = extractConsignment(
      page({
        [CONSIGNMENT_PAYOUT_PROPERTY]: { type: "formula", formula: {} },
      }),
    );
    expect(record.payout).toBeNull();
  });

  it("survives a placement with none of its properties set", () => {
    const record = extractConsignment(page());

    expect(record.placement).toBe("");
    expect(record.itemId).toBeUndefined();
    expect(record.settled).toBe(false);
    expect(record.settledOn).toBe("");
    expect(record.payout).toBeNull();
  });

  it("takes the first related item when a row names several", () => {
    const record = extractConsignment(
      page({
        [CONSIGNMENT_ITEM_PROPERTY]: {
          type: "relation",
          relation: [{ id: "inv-1" }, { id: "inv-2" }],
        },
      }),
    );
    expect(record.itemId).toBe("inv-1");
  });
});
