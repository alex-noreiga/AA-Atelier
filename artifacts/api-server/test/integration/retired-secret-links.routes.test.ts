// Guard: the atelier's shared-secret links stay retired.
//
// These were GET endpoints that authenticated with `?secret=<CRON_SECRET>` in
// the query string, opened from a formula property in Notion. They have been
// replaced by `POST /api/studio/tools/:tool`, which authorizes a signed-in staff
// session instead. Re-mounting any of them would put the secret back in URLs and
// browser history and hand anyone who has ever seen one the ability to move
// money — so this asserts they are gone even when CRON_SECRET is configured and
// the correct secret is supplied.
//
// Two of the retired paths aren't listed: `/api/orders/process-cancellation` and
// `/api/shop-orders/process-return`, the Bearer (non-`/run`) halves. Being single
// path segments, they now fall through to the `/orders/:orderNumber` and
// `/shop-orders/:orderNumber` status lookups, so "not routed here any more" isn't
// something a status code can show. Their `/run` twins below carry the guard.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../../src/app.js";

const RETIRED = [
  "/api/cron/generate-milestones/run",
  "/api/webhooks/notion-stage-change/run",
  "/api/invoices/generate-line-items",
  "/api/invoices/generate-line-items/run",
  "/api/orders/process-cancellation/run",
  "/api/shop-orders/process-return/run",
];

describe("retired shared-secret links", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it.each(RETIRED)("%s is no longer routed", async (path) => {
    const res = await request(app).get(`${path}?secret=s3cret&order=000002`);

    expect(res.status).toBe(404);
  });

  it("still serves the one scheduled endpoint that remains", async () => {
    // Not a `/run` link: Vercel Cron calls this with a Bearer header. Without one
    // it must refuse — proving the route exists and is still gated.
    const res = await request(app).get("/api/cron/generate-milestones");

    expect(res.status).toBe(401);
  });
});
