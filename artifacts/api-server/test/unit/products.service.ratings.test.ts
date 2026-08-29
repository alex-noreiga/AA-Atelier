import { describe, it, expect, vi, beforeEach } from "vitest";

// The ratings pass is the one part of `getProducts` that talks to a second
// database, so it is the one part with a way to go wrong that the shop must
// survive. Mock the three reads; everything between them runs for real.
vi.mock("../../src/lib/notion/products.repository.js", () => ({
  listVariants: vi.fn(),
}));
vi.mock("../../src/lib/notion/product-categories.repository.js", () => ({
  listCategoryRecords: vi.fn(),
}));
vi.mock("../../src/lib/notion/reviews.repository.js", () => ({
  listPublishedProductReviews: vi.fn(),
}));

import { getProducts } from "../../src/services/products.service.js";
import { listVariants } from "../../src/lib/notion/products.repository.js";
import { listCategoryRecords } from "../../src/lib/notion/product-categories.repository.js";
import { listPublishedProductReviews } from "../../src/lib/notion/reviews.repository.js";
import type { VariantRecord } from "../../src/lib/notion/products.schema.js";

const mockVariants = vi.mocked(listVariants);
const mockCategories = vi.mocked(listCategoryRecords);
const mockReviews = vi.mocked(listPublishedProductReviews);

function variant(overrides: Partial<VariantRecord> = {}): VariantRecord {
  return {
    id: "inv-a",
    name: "Aurora Soaker",
    available: true,
    photos: [],
    sizes: [],
    addOnIds: [],
    category: "",
    categoryId: "cat-1",
    group: null,
    instagramPostUrl: "",
    ...overrides,
  };
}

beforeEach(() => {
  mockVariants.mockResolvedValue([variant()]);
  mockCategories.mockResolvedValue([
    {
      id: "cat-1",
      name: "Soakers",
      sized: false,
      sizeGuide: "garment",
      sort: 1,
    },
  ]);
  mockReviews.mockResolvedValue([]);
});

describe("getProducts — customer ratings", () => {
  it("attaches the rating to the card the reviewed row sits on", async () => {
    mockReviews.mockResolvedValue([
      { id: "r1", rating: 5, comment: "Warm.", productIds: ["inv-a"] },
      { id: "r2", rating: 4, comment: "Dries fast.", productIds: ["inv-a"] },
    ]);

    const { products } = await getProducts();

    expect(products[0].rating).toMatchObject({ average: 4.5, count: 2 });
    expect(products[0].rating?.reviews.map((r) => r.comment)).toEqual([
      "Warm.",
      "Dries fast.",
    ]);
  });

  it("finds the grouped card a reviewed variant was folded into", async () => {
    mockVariants.mockResolvedValue([
      variant({ id: "inv-a", group: "Aurora Soaker" }),
      variant({
        id: "inv-b",
        name: "Aurora Soaker, rose",
        group: "Aurora Soaker",
      }),
    ]);
    mockReviews.mockResolvedValue([
      { id: "r1", rating: 3, comment: "Snug.", productIds: ["inv-b"] },
    ]);

    const { products } = await getProducts();

    expect(products).toHaveLength(1);
    expect(products[0].id).toBe("group-aurora-soaker");
    expect(products[0].rating).toMatchObject({ average: 3, count: 1 });
  });

  it("leaves a piece with no reviews carrying no rating field", async () => {
    const { products } = await getProducts();
    expect(products[0]).not.toHaveProperty("rating");
  });

  // A rating is something extra beside a piece. Losing the reviews database must
  // cost the cards their stars and nothing else.
  it("still serves the shop when the reviews read throws", async () => {
    mockReviews.mockRejectedValue(new Error("Notion down"));

    const { products } = await getProducts();

    expect(products).toHaveLength(1);
    expect(products[0].rating).toBeUndefined();
  });

  it("still fails loudly when the category database is unconfigured", async () => {
    mockCategories.mockResolvedValue(null);
    await expect(getProducts()).rejects.toThrow(
      /NOTION_PRODUCT_CATEGORIES_DATABASE_ID/,
    );
  });
});
