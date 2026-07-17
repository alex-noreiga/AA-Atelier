import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/notion/products.repository.js", () => ({
  listVariants: vi.fn(),
  listCategories: vi.fn(),
}));

vi.mock("../../src/lib/notion/product-categories.repository.js", () => ({
  listCategoryRecords: vi.fn(),
}));

import request from "supertest";
import { GENERIC_ERROR } from "@workspace/test-fixtures";
import app from "../../src/app.js";
import {
  listVariants,
  listCategories,
} from "../../src/lib/notion/products.repository.js";
import { listCategoryRecords } from "../../src/lib/notion/product-categories.repository.js";
import type { VariantRecord } from "../../src/lib/notion/products.schema.js";

const mockListVariants = vi.mocked(listVariants);
const mockListCategories = vi.mocked(listCategories);
const mockListCategoryRecords = vi.mocked(listCategoryRecords);

const CACHE_HEADER = "public, s-maxage=120, stale-while-revalidate=600";

function variant(overrides: Partial<VariantRecord> = {}): VariantRecord {
  return {
    id: "var-1",
    name: "Aurora Soaker",
    available: true,
    photos: [],
    sizes: [],
    category: "Ready to Wear",
    group: null,
    ...overrides,
  };
}

describe("GET /api/products", () => {
  it("falls back to Item Type + built-in sized list when Product Categories is unconfigured", async () => {
    mockListVariants.mockResolvedValue([variant()]);
    mockListCategories.mockResolvedValue(["Ready to Wear", "Dress"]);
    // null → "Product Categories" DB not configured, so the shop falls back to
    // the Item Type options + the built-in sized list, which has "Ready to Wear".
    mockListCategoryRecords.mockResolvedValue(null);

    const res = await request(app).get("/api/products");

    expect(res.status).toBe(200);
    // Ungrouped row → a standalone card titled by its name.
    expect(res.body.products).toEqual([
      {
        id: "var-1",
        title: "Aurora Soaker",
        category: "Ready to Wear",
        sized: true,
        variants: [
          {
            id: "var-1",
            name: "Aurora Soaker",
            available: true,
            photos: [],
            sizes: [],
          },
        ],
      },
    ]);
    // Only categories that actually have a card survive.
    expect(res.body.categories).toEqual(["Ready to Wear"]);
    expect(res.headers["cache-control"]).toBe(CACHE_HEADER);
  });

  it("resolves the category + sized flag from the relation when Product Categories is configured", async () => {
    // The variant links to the "Dress" category page; its Item Type label is
    // deliberately different to prove the relation wins over the select.
    mockListVariants.mockResolvedValue([
      variant({ category: "Old Label", categoryId: "cat-dress" }),
    ]);
    mockListCategoryRecords.mockResolvedValue([
      { id: "cat-dress", name: "Dress", sized: true, sort: 2 },
      { id: "cat-rtw", name: "Ready to Wear", sized: false, sort: 1 },
    ]);

    const res = await request(app).get("/api/products");

    expect(res.status).toBe(200);
    expect(res.body.products).toEqual([
      {
        id: "var-1",
        title: "Aurora Soaker",
        category: "Dress",
        sized: true,
        variants: [
          {
            id: "var-1",
            name: "Aurora Soaker",
            available: true,
            photos: [],
            sizes: [],
          },
        ],
      },
    ]);
    // Chips come from the category records (ordered by Sort), narrowed to the
    // one that's actually stocked. Item Type options aren't consulted.
    expect(res.body.categories).toEqual(["Dress"]);
    expect(mockListCategories).not.toHaveBeenCalled();
  });

  it("does not set the edge cache header on an error response", async () => {
    mockListVariants.mockRejectedValue(new Error("Notion query failed"));
    mockListCategories.mockResolvedValue([]);
    mockListCategoryRecords.mockResolvedValue(null);

    const res = await request(app).get("/api/products");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: GENERIC_ERROR });
    // An error must never be cached by the edge.
    expect(res.headers["cache-control"] ?? "").not.toContain("s-maxage");
  });
});
