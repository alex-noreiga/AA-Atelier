import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the service so the routes run end-to-end over the real Express stack
// without touching Notion or Stripe. `parseRefundTarget` is deliberately NOT
// mocked — the amount parsing is part of what these routes are responsible for.
vi.mock("../../src/services/return-refund.service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/services/return-refund.service.js")
  >("../../src/services/return-refund.service.js");
  return { ...actual, processReturnRefund: vi.fn() };
});

import request from "supertest";
import app from "../../src/app.js";
import {
  processReturnRefund,
  type ReturnRefundResult,
} from "../../src/services/return-refund.service.js";
import { NotFoundError } from "../../src/lib/errors.js";

const mockProcess = vi.mocked(processReturnRefund);

const JSON_ENDPOINT = "/api/shop-orders/process-return";
const RUN = "/api/shop-orders/process-return/run";

const okResult: ReturnRefundResult = {
  orderNumber: "SHP-1",
  status: "refunded",
  refunded: 180,
  totalRefunded: 180,
  captured: 200,
  fullyRefunded: false,
  markerFailed: false,
  notes: [],
};

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("GET /api/shop-orders/process-return (Bearer JSON)", () => {
  it("refunds and returns the summary with a valid bearer token", async () => {
    mockProcess.mockResolvedValue(okResult);

    const res = await request(app)
      .get(`${JSON_ENDPOINT}?order=SHP-1&amount=180`)
      .set("Authorization", "Bearer s3cret");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(okResult);
    // Dollars in the URL reach the service as integer cents.
    expect(mockProcess).toHaveBeenCalledWith("SHP-1", 18000);
  });

  it("passes an undefined target when ?amount= is omitted (refund in full)", async () => {
    mockProcess.mockResolvedValue({ ...okResult, refunded: 200 });

    await request(app)
      .get(`${JSON_ENDPOINT}?order=SHP-1`)
      .set("Authorization", "Bearer s3cret");

    expect(mockProcess).toHaveBeenCalledWith("SHP-1", undefined);
  });

  it("401s without a valid bearer token", async () => {
    const res = await request(app).get(`${JSON_ENDPOINT}?order=SHP-1`);
    expect(res.status).toBe(401);
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it("400s when ?order= is missing", async () => {
    const res = await request(app)
      .get(JSON_ENDPOINT)
      .set("Authorization", "Bearer s3cret");
    expect(res.status).toBe(400);
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it("400s on a malformed amount instead of refunding", async () => {
    const res = await request(app)
      .get(`${JSON_ENDPOINT}?order=SHP-1&amount=-5`)
      .set("Authorization", "Bearer s3cret");

    expect(res.status).toBe(400);
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it("404s for an unknown order", async () => {
    mockProcess.mockRejectedValue(new NotFoundError("no such order"));
    const res = await request(app)
      .get(`${JSON_ENDPOINT}?order=SHP-NOPE`)
      .set("Authorization", "Bearer s3cret");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/shop-orders/process-return/run (query token, HTML)", () => {
  it("renders a confirmation page with the refund summary", async () => {
    mockProcess.mockResolvedValue(okResult);

    const res = await request(app).get(
      `${RUN}?secret=s3cret&order=SHP-1&amount=180`,
    );

    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    expect(res.text).toContain("Refund processed");
    expect(res.text).toContain("$180.00");
    // Not fully refunded — the page should say what's left on the payment.
    expect(res.text).toContain("$20.00");
  });

  it("reports a Stripe failure plainly rather than claiming success", async () => {
    mockProcess.mockResolvedValue({
      ...okResult,
      status: "error",
      refunded: 0,
      totalRefunded: 0,
      notes: ["refund failed (No such checkout session)"],
    });

    const res = await request(app).get(`${RUN}?secret=s3cret&order=SHP-1`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("Refund needs attention");
    expect(res.text).toContain("No such checkout session");
  });

  it("401s (HTML) without a valid query token", async () => {
    const res = await request(app).get(`${RUN}?order=SHP-1`);
    expect(res.status).toBe(401);
    expect(res.type).toMatch(/html/);
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it("escapes the order number in the confirmation page", async () => {
    mockProcess.mockResolvedValue({
      ...okResult,
      orderNumber: "<script>alert(1)</script>",
    });

    const res = await request(app).get(`${RUN}?secret=s3cret&order=x`);

    expect(res.text).not.toContain("<script>alert(1)</script>");
    expect(res.text).toContain("&lt;script&gt;");
  });
});
