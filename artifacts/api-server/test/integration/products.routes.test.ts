import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/notion/products.repository.js", () => ({
  listVariants: vi.fn(),
  listCategories: vi.fn(),
}));

import request from "supertest";
import { GENERIC_ERROR } from "@workspace/test-fixtures";
import app from "../../src/app.js";
import {
  listVariants,
  listCategories,
} from "../../src/lib/notion/products.repository.js";
import type { VariantRecord } from "../../src/lib/notion/products.schema.js";

const mockListVariants = vi.mocked(listVariants);
const mockListCategories = vi.mocked(listCategories);

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
  it("returns 200 with grouped products, visible categories, and the edge cache header", async () => {
    mockListVariants.mockResolvedValue([variant()]);
    mockListCategories.mockResolvedValue(["Ready to Wear", "Dress"]);

    const res = await request(app).get("/api/products");

    expect(res.status).toBe(200);
    // Ungrouped row → a standalone card titled by its name.
    expect(res.body.products).toEqual([
      {
        id: "var-1",
        title: "Aurora Soaker",
        category: "Ready to Wear",
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

  it("does not set the edge cache header on an error response", async () => {
    mockListVariants.mockRejectedValue(new Error("Notion query failed"));
    mockListCategories.mockResolvedValue([]);

    const res = await request(app).get("/api/products");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: GENERIC_ERROR });
    // An error must never be cached by the edge.
    expect(res.headers["cache-control"] ?? "").not.toContain("s-maxage");
  });
});
