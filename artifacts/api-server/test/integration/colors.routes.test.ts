import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import app from "../../src/app.js";

const CACHE_HEADER = "public, s-maxage=120, stale-while-revalidate=600";

const prev = process.env.COLOR_PALETTE;
afterEach(() => {
  if (prev === undefined) delete process.env.COLOR_PALETTE;
  else process.env.COLOR_PALETTE = prev;
});

describe("GET /api/colors", () => {
  it("returns the built-in primary palette when unconfigured", async () => {
    delete process.env.COLOR_PALETTE;

    const res = await request(app).get("/api/colors");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.colors)).toBe(true);
    expect(res.body.colors.length).toBeGreaterThan(0);
    // Each color is the trimmed contract shape: id + name + hex only.
    for (const color of res.body.colors) {
      expect(Object.keys(color).sort()).toEqual(["hex", "id", "name"]);
    }
    expect(res.headers["cache-control"]).toBe(CACHE_HEADER);
  });

  it("returns the parsed COLOR_PALETTE override", async () => {
    process.env.COLOR_PALETTE = "Emerald #0B6E4F, Rose Gold #C5878C";

    const res = await request(app).get("/api/colors");

    expect(res.status).toBe(200);
    expect(res.body.colors).toEqual([
      { id: "emerald", name: "Emerald", hex: "#0B6E4F" },
      { id: "rose-gold", name: "Rose Gold", hex: "#C5878C" },
    ]);
  });
});
