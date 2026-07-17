import { describe, it, expect } from "vitest";
import {
  groupVariants,
  visibleCategories,
  resolveFromCategories,
} from "../../src/services/products.service.js";
import type {
  ProductRecord,
  VariantRecord,
} from "../../src/lib/notion/products.schema.js";
import type { CategoryRecord } from "../../src/lib/notion/product-categories.schema.js";

function card(category: string): ProductRecord {
  return {
    id: `id-${category}`,
    title: category,
    category,
    sized: false,
    variants: [],
  };
}

function variant(overrides: Partial<VariantRecord> = {}): VariantRecord {
  return {
    id: "v1",
    name: "Bow Soaker",
    available: true,
    photos: [],
    sizes: [],
    category: "Soaker",
    group: null,
    ...overrides,
  };
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
      visibleCategories(
        ["Costume", "Dress", "Hair Accessory"],
        [card("Dress")],
      ),
    ).toEqual(["Dress"]);
  });

  it("ignores a product whose Item Type is unset", () => {
    expect(visibleCategories(["Dress"], [card("")])).toEqual([]);
  });
});

describe("groupVariants", () => {
  it("makes an ungrouped row a standalone single-variant card keyed by its own id", () => {
    const products = groupVariants([
      variant({ id: "v-solo", name: "Solo Soaker", group: null }),
    ]);

    expect(products).toHaveLength(1);
    expect(products[0].id).toBe("v-solo");
    expect(products[0].title).toBe("Solo Soaker");
    expect(products[0].variants).toHaveLength(1);
    expect(products[0].variants[0].id).toBe("v-solo");
  });

  it("merges rows that share a Website Group into one card titled by the group", () => {
    const products = groupVariants([
      variant({ id: "v-black", name: "Bow — Black", group: "Bow Soakers" }),
      variant({ id: "v-red", name: "Bow — Red", group: "Bow Soakers" }),
    ]);

    expect(products).toHaveLength(1);
    expect(products[0].id).toBe("group-bow-soakers");
    expect(products[0].title).toBe("Bow Soakers");
    expect(products[0].variants.map((v) => v.id)).toEqual(["v-black", "v-red"]);
  });

  it("preserves first-seen order across interleaved grouped and standalone rows", () => {
    const products = groupVariants([
      variant({ id: "v-a", group: "Group A" }),
      variant({ id: "v-solo", group: null }),
      variant({ id: "v-a2", group: "Group A" }),
    ]);

    // The group's card is created on first sight, so it stays ahead of the
    // standalone row even though its second variant appears later.
    expect(products.map((p) => p.id)).toEqual(["group-group-a", "v-solo"]);
    expect(products[0].variants.map((v) => v.id)).toEqual(["v-a", "v-a2"]);
  });

  it("drops the category/group fields from the nested variant records", () => {
    const [product] = groupVariants([
      variant({ id: "v-solo", category: "Soaker", group: null }),
    ]);
    expect(product.variants[0]).not.toHaveProperty("category");
    expect(product.variants[0]).not.toHaveProperty("group");
  });

  it("sets each card's `sized` flag from the passed sized-category set", () => {
    const products = groupVariants(
      [
        variant({ id: "v-dress", category: "Dress", group: null }),
        variant({ id: "v-soaker", category: "Soaker", group: null }),
      ],
      new Set(["Dress"]),
    );

    const sizedById = Object.fromEntries(
      products.map((product) => [product.id, product.sized]),
    );
    expect(sizedById["v-dress"]).toBe(true);
    expect(sizedById["v-soaker"]).toBe(false);
  });

  it("defaults `sized` to false when no sized-category set is passed", () => {
    const [product] = groupVariants([variant({ category: "Dress" })]);
    expect(product.sized).toBe(false);
  });
});

describe("resolveFromCategories", () => {
  const records: CategoryRecord[] = [
    { id: "cat-rtw", name: "Ready to Wear", sized: false, sort: 1 },
    { id: "cat-dress", name: "Dress", sized: true, sort: 2 },
    { id: "cat-soakers", name: "Skate Soakers", sized: false, sort: 3 },
  ];

  it("resolves each card's category + sized flag from the linked category record", () => {
    const { products } = resolveFromCategories(
      [
        variant({ id: "v-dress", category: "stale", categoryId: "cat-dress" }),
        variant({
          id: "v-soaker",
          category: "stale",
          categoryId: "cat-soakers",
        }),
      ],
      records,
    );

    const byId = Object.fromEntries(
      products.map((p) => [p.id, { category: p.category, sized: p.sized }]),
    );
    // The linked record's name + sized flag win over the raw row value.
    expect(byId["v-dress"]).toEqual({ category: "Dress", sized: true });
    expect(byId["v-soaker"]).toEqual({
      category: "Skate Soakers",
      sized: false,
    });
  });

  it("orders the chip list by Sort, narrowed to stocked categories", () => {
    const { categories } = resolveFromCategories(
      [
        variant({ id: "v-soaker", categoryId: "cat-soakers" }),
        variant({ id: "v-dress", categoryId: "cat-dress" }),
      ],
      records,
    );
    // Sorted by Sort (Dress=2 before Skate Soakers=3); "Ready to Wear" (sort 1)
    // is dropped because nothing is stocked in it.
    expect(categories).toEqual(["Dress", "Skate Soakers"]);
  });

  it("leaves a row with no category link unresolved (empty category, no chip)", () => {
    // A published row that isn't linked to a category resolves to the raw empty
    // category (extractVariant sets ""), so it's unsized and yields no chip.
    const { products, categories } = resolveFromCategories(
      [variant({ id: "v-x", category: "" })],
      records,
    );
    expect(products[0].category).toBe("");
    expect(products[0].sized).toBe(false);
    expect(categories).toEqual([]);
  });

  it("leaves a row unresolved when its linked category id is unknown (deleted category)", () => {
    const { products } = resolveFromCategories(
      [variant({ id: "v-x", category: "", categoryId: "cat-gone" })],
      records,
    );
    expect(products[0].category).toBe("");
    expect(products[0].sized).toBe(false);
  });
});
