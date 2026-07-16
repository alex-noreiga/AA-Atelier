import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/notion/portfolio.repository.js", () => ({
  listPortfolioItems: vi.fn(),
  listCategories: vi.fn(),
}));

import request from "supertest";
import { GENERIC_ERROR } from "@workspace/test-fixtures";
import app from "../../src/app.js";
import {
  listPortfolioItems,
  listCategories,
} from "../../src/lib/notion/portfolio.repository.js";
import type { PortfolioItemRecord } from "../../src/lib/notion/portfolio.schema.js";

const mockListItems = vi.mocked(listPortfolioItems);
const mockListCategories = vi.mocked(listCategories);

const CACHE_HEADER = "public, s-maxage=120, stale-while-revalidate=600";

function item(overrides: Partial<PortfolioItemRecord> = {}): PortfolioItemRecord {
  return {
    id: "i1",
    title: "Aurora Dress",
    photos: ["https://img/a.jpg"],
    category: "Dresses",
    ...overrides,
  };
}

describe("GET /api/portfolio", () => {
  it("returns 200 with items, visible categories, and the edge cache header", async () => {
    mockListItems.mockResolvedValue([item()]);
    mockListCategories.mockResolvedValue(["Dresses", "Leotards"]);

    const res = await request(app).get("/api/portfolio");

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      {
        id: "i1",
        title: "Aurora Dress",
        photos: ["https://img/a.jpg"],
        category: "Dresses",
      },
    ]);
    // Only categories that actually have an item survive.
    expect(res.body.categories).toEqual(["Dresses"]);
    expect(res.headers["cache-control"]).toBe(CACHE_HEADER);
  });

  it("does not set the edge cache header on an error response", async () => {
    mockListItems.mockRejectedValue(new Error("Notion query failed"));
    mockListCategories.mockResolvedValue([]);

    const res = await request(app).get("/api/portfolio");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: GENERIC_ERROR });
    expect(res.headers["cache-control"] ?? "").not.toContain("s-maxage");
  });
});
