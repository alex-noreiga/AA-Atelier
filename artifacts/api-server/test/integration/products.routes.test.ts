import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/notion/products.repository.js", () => ({
  listVariants: vi.fn(),
}));

vi.mock("../../src/lib/notion/product-categories.repository.js", () => ({
  listCategoryRecords: vi.fn(),
}));

import request from "supertest";
import { GENERIC_ERROR } from "@workspace/test-fixtures";
import app from "../../src/app.js";
import { listVariants } from "../../src/lib/notion/products.repository.js";
import { listCategoryRecords } from "../../src/lib/notion/product-categories.repository.js";
import type { VariantRecord } from "../../src/lib/notion/products.schema.js";

const mockListVariants = vi.mocked(listVariants);
const mockListCategoryRecords = vi.mocked(listCategoryRecords);

const CACHE_HEADER = "public, s-maxage=120, stale-while-revalidate=600";

function variant(overrides: Partial<VariantRecord> = {}): VariantRecord {
  return {
    id: "var-1",
    name: "Aurora Soaker",
    available: true,
    photos: [],
    sizes: [],
    addOnIds: [],
    category: "",
    group: null,
    ...overrides,
  };
}

describe("GET /api/products", () => {
  it("resolves the category + sized flag from the linked category relation", async () => {
    mockListVariants.mockResolvedValue([variant({ categoryId: "cat-dress" })]);
    mockListCategoryRecords.mockResolvedValue([
      {
        id: "cat-dress",
        name: "Dress",
        sized: true,
        sizeGuide: "garment",
        sort: 2,
      },
      {
        id: "cat-rtw",
        name: "Ready to Wear",
        sized: false,
        sizeGuide: "garment",
        sort: 1,
      },
    ]);

    const res = await request(app).get("/api/products");

    expect(res.status).toBe(200);
    // Ungrouped row → a standalone card, category + sized from the linked record.
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
    // one that's actually stocked.
    expect(res.body.categories).toEqual(["Dress"]);
    expect(res.headers["cache-control"]).toBe(CACHE_HEADER);
  });

  it("returns 500 (no cache) when the Product Categories database is unconfigured", async () => {
    mockListVariants.mockResolvedValue([variant({ categoryId: "cat-dress" })]);
    // null → no category source; the shop has no fallback, so it fails loud.
    mockListCategoryRecords.mockResolvedValue(null);

    const res = await request(app).get("/api/products");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: GENERIC_ERROR });
    expect(res.headers["cache-control"] ?? "").not.toContain("s-maxage");
  });

  it("does not set the edge cache header on an error response", async () => {
    mockListVariants.mockRejectedValue(new Error("Notion query failed"));
    mockListCategoryRecords.mockResolvedValue([]);

    const res = await request(app).get("/api/products");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: GENERIC_ERROR });
    // An error must never be cached by the edge.
    expect(res.headers["cache-control"] ?? "").not.toContain("s-maxage");
  });
});
