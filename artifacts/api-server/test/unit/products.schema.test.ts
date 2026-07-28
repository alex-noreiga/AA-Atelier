import { describe, it, expect } from "vitest";
import {
  computeSizeOptions,
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

describe("extractVariant mapping", () => {
  it("maps every property, extracts photo URLs, and derives availability", () => {
    const page = {
      id: "page-full",
      properties: {
        "Item Name": {
          type: "title",
          title: [{ plain_text: "Keyhole Dress" }],
        },
        Category: { type: "relation", relation: [{ id: "cat-dress" }] },
        "Listed Price": { type: "number", number: 189 },
        Status: { type: "status", status: { name: "In Stock" } },
        "Quantity Available": {
          type: "formula",
          formula: { type: "number", number: 3 },
        },
        "Listing Notes": {
          type: "rich_text",
          rich_text: [{ plain_text: "Hand-beaded bodice." }],
        },
        "Website Group": { type: "select", select: { name: "Competition" } },
        "Matching Add-ons": {
          type: "relation",
          relation: [{ id: "cloth-1" }, { id: "cloth-2" }],
        },
        "Website Photos": {
          type: "files",
          files: [
            { type: "file", file: { url: "https://notion.test/a.jpg" } },
            { type: "external", external: { url: "https://cdn.test/b.jpg" } },
            { type: "file" }, // no url -> filtered out
          ],
        },
      },
    } as unknown as NotionInventoryPage;

    // The category NAME is resolved from the relation in the service; the raw row
    // maps only the linked category id (and category stays "").
    expect(extractVariant(page)).toEqual({
      id: "page-full",
      name: "Keyhole Dress",
      available: true,
      price: 189,
      description: "Hand-beaded bodice.",
      photos: ["https://notion.test/a.jpg", "https://cdn.test/b.jpg"],
      sizes: [],
      quantityAvailable: 3,
      addOnIds: ["cloth-1", "cloth-2"],
      category: "",
      categoryId: "cat-dress",
      group: "Competition",
    });
  });

  it("maps the Matching Add-ons relation to add-on ids in Notion order, empty when absent", () => {
    const withAddOns = {
      id: "soaker",
      properties: {
        "Item Name": { type: "title", title: [{ plain_text: "Bow Soaker" }] },
        "Matching Add-ons": {
          type: "relation",
          relation: [{ id: "cloth-pink" }],
        },
      },
    } as unknown as NotionInventoryPage;
    expect(extractVariant(withAddOns).addOnIds).toEqual(["cloth-pink"]);

    const withoutAddOns = {
      id: "cloth",
      properties: {
        "Item Name": { type: "title", title: [{ plain_text: "Blade Towel" }] },
      },
    } as unknown as NotionInventoryPage;
    expect(extractVariant(withoutAddOns).addOnIds).toEqual([]);
  });

  it("omits optional fields when the source properties are absent or empty", () => {
    const page = {
      id: "page-min",
      properties: {
        "Item Name": { type: "title", title: [{ plain_text: "Soaker" }] },
      },
    } as unknown as NotionInventoryPage;

    const variant = extractVariant(page);
    expect(variant.price).toBeUndefined();
    expect(variant.description).toBeUndefined();
    expect(variant.quantityAvailable).toBeUndefined();
    expect(variant).toMatchObject({
      photos: [],
      category: "",
      group: null,
      available: false, // no "In Stock" status
    });
  });
});

describe("extractVariant availability", () => {
  function pageWith(
    status: string | null,
    quantity: number | null,
  ): NotionInventoryPage {
    return {
      id: "p",
      properties: {
        "Item Name": { type: "title", title: [{ plain_text: "X" }] },
        ...(status
          ? { Status: { type: "status", status: { name: status } } }
          : {}),
        ...(quantity !== null
          ? {
              "Quantity Available": {
                type: "formula",
                formula: { type: "number", number: quantity },
              },
            }
          : {}),
      },
    } as unknown as NotionInventoryPage;
  }

  it("is unavailable when the status isn't In Stock", () => {
    expect(extractVariant(pageWith("Reserved", 5)).available).toBe(false);
  });

  it("is available when In Stock with a positive quantity", () => {
    expect(extractVariant(pageWith("In Stock", 2)).available).toBe(true);
  });

  it("is unavailable when In Stock but the quantity is zero", () => {
    expect(extractVariant(pageWith("In Stock", 0)).available).toBe(false);
  });

  it("treats In Stock with no quantity formula as available (one-off items)", () => {
    expect(extractVariant(pageWith("In Stock", null)).available).toBe(true);
  });
});

describe("extractVariant sizes", () => {
  it("maps the Sizes Offered / Sizes Available multi-selects onto the variant", () => {
    const page = {
      id: "page-1",
      properties: {
        "Item Name": {
          type: "title",
          title: [{ plain_text: "Keyhole Dress" }],
        },
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
