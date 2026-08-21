import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/app.js";

const CACHE_HEADER = "public, s-maxage=3600, stale-while-revalidate=86400";

describe("GET /api/services", () => {
  it("serves the intake service catalog", async () => {
    const res = await request(app).get("/api/services");

    expect(res.status).toBe(200);
    expect(res.body.services.map((s: { id: string }) => s.id)).toEqual([
      "bespoke",
      "alterations",
      "rhinestoning",
      "repairs",
    ]);
    expect(res.headers["cache-control"]).toBe(CACHE_HEADER);
  });

  it("serves each service as the trimmed contract shape", async () => {
    const res = await request(app).get("/api/services");

    for (const service of res.body.services) {
      // The atelier-facing wording (the Notion title suffix, the confirmation
      // email's opening line) stays on the server.
      expect(Object.keys(service).sort()).toEqual([
        "colors",
        "detailsHelp",
        "detailsLabel",
        "detailsRequired",
        "id",
        "measurements",
        "name",
        "summary",
      ]);
    }
  });

  it("reports the flags the intake form branches on", async () => {
    const res = await request(app).get("/api/services");
    const byId = Object.fromEntries(
      res.body.services.map((s: { id: string }) => [s.id, s]),
    );

    expect(byId.bespoke).toMatchObject({
      measurements: true,
      detailsRequired: false,
    });
    expect(byId.repairs).toMatchObject({
      measurements: false,
      colors: false,
      detailsRequired: true,
    });
  });
});
