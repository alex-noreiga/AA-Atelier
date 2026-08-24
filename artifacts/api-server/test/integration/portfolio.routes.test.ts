import { describe, it, expect, vi } from "vitest";

// Mock only the Notion read; the HTTP stack (routing → service → response
// schema parse → error handler) runs for real.
vi.mock("../../src/lib/notion/portfolio.repository.js", () => ({
  listPublishedPortfolioPieces: vi.fn(),
  portfolioConfigured: vi.fn(() => true),
}));

import request from "supertest";
import app from "../../src/app.js";
import { listPublishedPortfolioPieces } from "../../src/lib/notion/portfolio.repository.js";
import type { PortfolioPieceRecord } from "../../src/lib/notion/portfolio.schema.js";

const mockList = vi.mocked(listPublishedPortfolioPieces);

const piece = (
  overrides: Partial<PortfolioPieceRecord> = {},
): PortfolioPieceRecord => ({
  id: "piece-1",
  title: "Toothless",
  images: ["https://notion.test/a.png"],
  facets: [{ id: "type", values: ["Completed Dress"] }],
  publishedAt: "2026-06-01T00:00:00.000Z",
  ...overrides,
});

describe("GET /api/portfolio", () => {
  it("returns the published pieces", async () => {
    mockList.mockResolvedValue([piece()]);

    const res = await request(app).get("/api/portfolio");

    expect(res.status).toBe(200);
    expect(res.body.pieces).toHaveLength(1);
    expect(res.body.pieces[0]).toMatchObject({
      id: "piece-1",
      title: "Toothless",
      images: ["https://notion.test/a.png"],
      facets: [{ id: "type", values: ["Completed Dress"] }],
    });
  });

  it("returns an empty gallery when nothing is published", async () => {
    mockList.mockResolvedValue([]);

    const res = await request(app).get("/api/portfolio");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pieces: [], filters: [] });
  });

  it("derives the filter chips from the pieces it is serving", async () => {
    mockList.mockResolvedValue([
      piece({ id: "a", facets: [{ id: "type", values: ["Completed Dress"] }] }),
      piece({
        id: "b",
        facets: [
          { id: "type", values: ["Preliminary Sketch"] },
          { id: "discipline", values: ["Ice Dance"] },
        ],
      }),
    ]);

    const res = await request(app).get("/api/portfolio");

    // `type` varies across the two pieces so it earns a chip row; `discipline`
    // has one value across the whole gallery, so filtering on it is a no-op.
    expect(res.body.filters).toEqual([
      {
        id: "type",
        label: "Type",
        options: ["Completed Dress", "Preliminary Sketch"],
      },
    ]);
  });

  it("caches at the edge for less than Notion's signed-image lifetime", async () => {
    mockList.mockResolvedValue([]);

    const res = await request(app).get("/api/portfolio");

    const header = res.headers["cache-control"]!;
    expect(header).toContain("s-maxage=120");
    expect(header).toContain("stale-while-revalidate=600");

    // The images in this payload are Notion-signed and die after ~1 hour, so
    // the total cached lifetime has to stay well inside that.
    const total = [
      ...header.matchAll(/(?:s-maxage|stale-while-revalidate)=(\d+)/g),
    ]
      .map((m) => Number(m[1]))
      .reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(3600);
  });

  it("does not cache a failed read", async () => {
    mockList.mockRejectedValue(new Error("notion is down"));

    const res = await request(app).get("/api/portfolio");

    expect(res.status).toBe(500);
    expect(res.headers["cache-control"]).toBeUndefined();
  });
});
