import { describe, it, expect } from "vitest";
import {
  extractMaterial,
  type NotionMaterialPage,
} from "../../src/lib/notion/materials.schema.js";

function page(
  properties: Record<string, unknown>,
  id = "mat-1",
): NotionMaterialPage {
  return { id, properties } as NotionMaterialPage;
}

describe("extractMaterial", () => {
  it("maps the title, category, stock formula, reorder point and link", () => {
    const material = extractMaterial(
      page({
        "Item Name": { type: "title", title: [{ plain_text: "Black Fleece" }] },
        Category: { type: "select", select: { name: "Fabric" } },
        "Stock on Hand": { type: "formula", formula: { number: 0.25 } },
        "Minimum Stock": { type: "number", number: 0.5 },
        "Restock Alerts On/Off": { type: "checkbox", checkbox: false },
        "Material Link": { type: "url", url: "https://example.test/fleece" },
        "Price per Unit": { type: "number", number: 8.99 },
      }),
    );

    expect(material).toEqual({
      id: "mat-1",
      name: "Black Fleece",
      category: "Fabric",
      stockOnHand: 0.25,
      minimumStock: 0.5,
      alertsSuppressed: false,
      link: "https://example.test/fleece",
      pricePerUnit: 8.99,
    });
  });

  // The property is NAMED like an enable switch; its Notion description says it
  // suppresses. Ticked must read as muted, or the panel inverts.
  it("reads a ticked alerts checkbox as suppressed", () => {
    const material = extractMaterial(
      page({ "Restock Alerts On/Off": { type: "checkbox", checkbox: true } }),
    );
    expect(material.alertsSuppressed).toBe(true);
  });

  // Absent is not zero: "we have none" and "we have never counted" differ.
  it("maps a stock formula with no number to null, not zero", () => {
    const material = extractMaterial(
      page({ "Stock on Hand": { type: "formula", formula: { number: null } } }),
    );
    expect(material.stockOnHand).toBeNull();
  });

  it("degrades every absent property rather than throwing", () => {
    const material = extractMaterial(page({}));
    expect(material).toEqual({
      id: "mat-1",
      name: "",
      stockOnHand: null,
      minimumStock: null,
      alertsSuppressed: false,
    });
  });
});
