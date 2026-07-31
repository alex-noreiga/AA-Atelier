import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/notion/fabrics.repository.js", () => ({
  listFabricRecords: vi.fn(),
}));

import request from "supertest";
import { GENERIC_ERROR } from "@workspace/test-fixtures";
import app from "../../src/app.js";
import { listFabricRecords } from "../../src/lib/notion/fabrics.repository.js";
import type { FabricRecord } from "../../src/lib/notion/fabrics.schema.js";

const mockListFabricRecords = vi.mocked(listFabricRecords);

const CACHE_HEADER = "public, s-maxage=120, stale-while-revalidate=600";

describe("GET /api/fabrics", () => {
  it("returns the swatch list (sort omitted when null) with the edge cache header", async () => {
    const records: FabricRecord[] = [
      {
        id: "f-solid",
        name: "Ivory",
        type: "solid",
        placement: "both",
        hex: "#F4EFE6",
        sort: 1,
      },
      {
        id: "f-print",
        name: "Floral",
        type: "print",
        placement: "bodice",
        swatchImage: "https://cdn/floral.jpg",
        sort: null,
      },
    ];
    mockListFabricRecords.mockResolvedValue(records);

    const res = await request(app).get("/api/fabrics");

    expect(res.status).toBe(200);
    expect(res.body.fabrics).toEqual([
      {
        id: "f-solid",
        name: "Ivory",
        type: "solid",
        placement: "both",
        hex: "#F4EFE6",
        sort: 1,
      },
      {
        id: "f-print",
        name: "Floral",
        type: "print",
        placement: "bodice",
        swatchImage: "https://cdn/floral.jpg",
      },
    ]);
    expect(res.headers["cache-control"]).toBe(CACHE_HEADER);
  });

  it("returns an empty list (still 200) when the Fabrics database is unconfigured", async () => {
    // The repository returns [] when NOTION_FABRICS_DATABASE_ID is unset.
    mockListFabricRecords.mockResolvedValue([]);

    const res = await request(app).get("/api/fabrics");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ fabrics: [] });
    expect(res.headers["cache-control"]).toBe(CACHE_HEADER);
  });

  it("does not set the edge cache header on an error response", async () => {
    mockListFabricRecords.mockRejectedValue(new Error("Notion query failed"));

    const res = await request(app).get("/api/fabrics");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: GENERIC_ERROR });
    expect(res.headers["cache-control"] ?? "").not.toContain("s-maxage");
  });
});
