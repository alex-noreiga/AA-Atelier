import { describe, it, expect } from "vitest";
import { visibleCategories } from "../../src/services/products.service.js";
import type { ProductRecord } from "../../src/lib/notion/products.schema.js";

function card(category: string): ProductRecord {
  return { id: `id-${category}`, title: category, category, variants: [] };
}

describe("visibleCategories", () => {
  it("keeps Notion's ordering rather than sorting", () => {
    // "Other" is deliberately last in Notion; alphabetising would bury it.
    expect(
      visibleCategories(
        ["Dress", "Soaker", "Other"],
        [card("Other"), card("Dress"), card("Soaker")],
      ),
    ).toEqual(["Dress", "Soaker", "Other"]);
  });

  it("drops an option the team defined but hasn't stocked", () => {
    // Otherwise the chip renders and clicking it shows an empty grid.
    expect(
      visibleCategories(["Costume", "Dress", "Hair Accessory"], [card("Dress")]),
    ).toEqual(["Dress"]);
  });

  it("ignores a product whose Item Type is unset", () => {
    expect(visibleCategories(["Dress"], [card("")])).toEqual([]);
  });
});
