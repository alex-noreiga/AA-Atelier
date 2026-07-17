import { describe, it, expect } from "vitest";
import {
  groupVariants,
  visibleCategories,
} from "../../src/services/products.service.js";
import type {
  ProductRecord,
  VariantRecord,
} from "../../src/lib/notion/products.schema.js";

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
