import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the cancellation service so the route runs end-to-end over the real
// Express stack without touching Notion or Stripe.
vi.mock("../../src/services/order-cancellation.service.js", () => ({
  processCancellation: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import { processCancellation } from "../../src/services/order-cancellation.service.js";
import { NotFoundError } from "../../src/lib/errors.js";
import type { CancellationResult } from "../../src/services/order-cancellation.service.js";

const mockProcess = vi.mocked(processCancellation);

const JSON_ENDPOINT = "/api/orders/process-cancellation";
const RUN = "/api/orders/process-cancellation/run";

const okResult: CancellationResult = {
  orderType: "custom",
  orderNumber: "ORD-1",
  refundsIssued: 2,
  totalRefunded: 400,
  alreadyCancelled: false,
  cancelledNow: true,
  hadError: false,
  skipped: [],
};

describe("GET /api/orders/process-cancellation (Bearer JSON)", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("processes the order and returns the summary with a valid bearer token", async () => {
    mockProcess.mockResolvedValue(okResult);

    const res = await request(app)
      .get(`${JSON_ENDPOINT}?order=ORD-1`)
      .set("Authorization", "Bearer s3cret");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(okResult);
    expect(mockProcess).toHaveBeenCalledWith("ORD-1");
  });

  it("returns 400 when the order query param is missing", async () => {
    const res = await request(app)
      .get(JSON_ENDPOINT)
      .set("Authorization", "Bearer s3cret");
    expect(res.status).toBe(400);
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it("maps a NotFoundError to 404", async () => {
    mockProcess.mockRejectedValue(new NotFoundError("no order"));
    const res = await request(app)
      .get(`${JSON_ENDPOINT}?order=ORD-x`)
      .set("Authorization", "Bearer s3cret");
    expect(res.status).toBe(404);
  });

  it("returns 401 without a valid bearer token", async () => {
    const res = await request(app)
      .get(`${JSON_ENDPOINT}?order=ORD-1`)
      .set("Authorization", "Bearer nope");
    expect(res.status).toBe(401);
    expect(mockProcess).not.toHaveBeenCalled();
  });
});

describe("GET /api/orders/process-cancellation/run (Notion link)", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("processes and returns an HTML confirmation for a valid query secret", async () => {
    mockProcess.mockResolvedValue(okResult);

    const res = await request(app).get(`${RUN}?secret=s3cret&order=ORD-1`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Cancellation processed");
    expect(res.text).toContain("refunded 2 payments totalling $400.00");
    expect(res.text).toContain("now marked cancelled");
  });

  it("reports a re-press where nothing new happened", async () => {
    mockProcess.mockResolvedValue({
      ...okResult,
      refundsIssued: 0,
      totalRefunded: 0,
      alreadyCancelled: true,
      cancelledNow: false,
    });

    const res = await request(app).get(`${RUN}?secret=s3cret&order=ORD-1`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("no new refunds were needed");
    expect(res.text).toContain("already cancelled");
  });

  it("warns (and does not claim success) when a refund errored", async () => {
    mockProcess.mockResolvedValue({
      ...okResult,
      refundsIssued: 1,
      cancelledNow: false,
      hadError: true,
      skipped: ["Balance: refund failed (No such session)"],
    });

    const res = await request(app).get(`${RUN}?secret=s3cret&order=ORD-1`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("needs attention");
    expect(res.text).toContain("left uncancelled");
  });

  it("escapes dynamic values in the HTML confirmation (no reflected XSS)", async () => {
    mockProcess.mockResolvedValue({
      ...okResult,
      orderNumber: "<script>alert(1)</script>",
    });

    const res = await request(app).get(
      `${RUN}?secret=s3cret&order=%3Cscript%3E`,
    );

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("<script>alert(1)</script>");
    expect(res.text).toContain("&lt;script&gt;");
  });

  it("returns 400 (HTML) when no order is provided", async () => {
    const res = await request(app).get(`${RUN}?secret=s3cret`);
    expect(res.status).toBe(400);
    expect(res.text).toContain("Missing order");
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it("returns 401 (HTML) for a wrong secret and does not run", async () => {
    const res = await request(app).get(`${RUN}?secret=nope&order=ORD-1`);
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Not authorized");
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it("renders an HTML 500 page if the service throws unexpectedly", async () => {
    mockProcess.mockRejectedValue(new Error("Stripe is down"));

    const res = await request(app).get(`${RUN}?secret=s3cret&order=ORD-1`);
    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Something went wrong");
  });
});
