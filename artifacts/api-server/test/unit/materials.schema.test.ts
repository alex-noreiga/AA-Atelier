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

  // `Fabric Type` is a MULTI-select — a power mesh that is also a lining carries
  // two — so it maps to an array in the atelier's own order. The dashboard files
  // the row under the first; the schema just refuses to lose the rest.
  it("maps the fabric types, in the order Notion holds them", () => {
    const material = extractMaterial(
      page({
        "Fabric Type": {
          type: "multi_select",
          multi_select: [{ name: "Power Mesh" }, { name: "Lining" }],
        },
      }),
    );

    expect(material.fabricTypes).toEqual(["Power Mesh", "Lining"]);
  });

  it("omits fabric types entirely when none are tagged", () => {
    // Which is every non-fabric material — an empty array on a box of garment
    // bags would make the panel sub-group packaging under "Unspecified".
    const withNone = extractMaterial(
      page({ "Fabric Type": { type: "multi_select", multi_select: [] } }),
    );
    expect(withNone.fabricTypes).toBeUndefined();
    expect(extractMaterial(page({})).fabricTypes).toBeUndefined();
  });

  it("drops a blank option name rather than producing an empty group", () => {
    const material = extractMaterial(
      page({
        "Fabric Type": {
          type: "multi_select",
          multi_select: [{ name: "  Satin " }, { name: "   " }],
        },
      }),
    );

    expect(material.fabricTypes).toEqual(["Satin"]);
  });

  // Mostly unset in the live data — 38 of 50 rows — so absent must stay absent
  // rather than becoming a value the service could mistake for "no".
  it("maps the reorder status, and omits it when unset", () => {
    const marked = extractMaterial(
      page({
        "Reorder Status": { type: "select", select: { name: "Deadstock" } },
      }),
    );
    expect(marked.reorderStatus).toBe("Deadstock");

    const unset = extractMaterial(
      page({ "Reorder Status": { type: "select", select: null } }),
    );
    expect(unset.reorderStatus).toBeUndefined();
    expect(extractMaterial(page({})).reorderStatus).toBeUndefined();
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
