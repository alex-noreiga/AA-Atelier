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
        "capacityGated",
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
      capacityGated: true,
    });
    expect(byId.repairs).toMatchObject({
      measurements: false,
      colors: false,
      detailsRequired: true,
      capacityGated: false,
    });
  });

  it("gates only the bespoke commission on capacity", async () => {
    const res = await request(app).get("/api/services");

    // The three services performed on a piece the customer already owns keep
    // taking orders when the commission book is full — closing them would
    // refuse hours of work over weeks of it.
    const gated = res.body.services
      .filter((s: { capacityGated: boolean }) => s.capacityGated)
      .map((s: { id: string }) => s.id);
    expect(gated).toEqual(["bespoke"]);
  });
});
