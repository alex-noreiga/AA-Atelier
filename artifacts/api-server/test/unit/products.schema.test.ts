import { describe, it, expect } from "vitest";
import {
  computeSizeOptions,
  extractCategoryOptions,
  extractVariant,
  type NotionInventoryPage,
} from "../../src/lib/notion/products.schema.js";

describe("computeSizeOptions", () => {
  it("flags an offered size that isn't in stock as sold out", () => {
    expect(
      computeSizeOptions(
        ["Adult XS", "Adult S", "Adult M"],
        ["Adult XS", "Adult M"],
      ),
    ).toEqual([
      { name: "Adult XS", available: true },
      { name: "Adult S", available: false },
      { name: "Adult M", available: true },
    ]);
  });

  it("preserves the order the sizes are listed in Notion", () => {
    const sizes = computeSizeOptions(["Child XL", "Adult XS"], []);
    expect(sizes.map((s) => s.name)).toEqual(["Child XL", "Adult XS"]);
  });

  it("still shows a size marked available but never offered", () => {
    // The likely data-entry slip; hiding stock we actually have is the worse bug.
    expect(computeSizeOptions([], ["Adult M"])).toEqual([
      { name: "Adult M", available: true },
    ]);
  });

  it("returns nothing for a one-size item", () => {
    expect(computeSizeOptions([], [])).toEqual([]);
  });
});

describe("extractCategoryOptions", () => {
  it("reads the live Item Type options in Notion's order", () => {
    expect(
      extractCategoryOptions({
        properties: {
          "Item Type": {
            type: "select",
            select: {
              options: [{ name: "Dress" }, { name: "Soaker" }, { name: "Other" }],
            },
          },
        },
      }),
    ).toEqual(["Dress", "Soaker", "Other"]);
  });

  it("returns an empty list when the property is missing", () => {
    // A missing filter bar must not fail the whole shop.
    expect(extractCategoryOptions({ properties: {} })).toEqual([]);
  });
});

describe("extractVariant sizes", () => {
  it("maps the Sizes Offered / Sizes Available multi-selects onto the variant", () => {
    const page = {
      id: "page-1",
      properties: {
        "Item Name": { type: "title", title: [{ plain_text: "Keyhole Dress" }] },
        "Sizes Offered": {
          type: "multi_select",
          multi_select: [{ name: "Adult S" }, { name: "Adult M" }],
        },
        "Sizes Available": {
          type: "multi_select",
          multi_select: [{ name: "Adult M" }],
        },
      },
    } as unknown as NotionInventoryPage;

    expect(extractVariant(page).sizes).toEqual([
      { name: "Adult S", available: false },
      { name: "Adult M", available: true },
    ]);
  });

  it("gives a one-size item an empty size list", () => {
    const page = {
      id: "page-2",
      properties: {
        "Item Name": { type: "title", title: [{ plain_text: "Soakers" }] },
      },
    } as unknown as NotionInventoryPage;

    expect(extractVariant(page).sizes).toEqual([]);
  });
});
