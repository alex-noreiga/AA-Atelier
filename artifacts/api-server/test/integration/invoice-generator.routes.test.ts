import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the generator service so the route runs end-to-end over the real Express
// stack without touching Notion.
vi.mock("../../src/services/invoice-generator.service.js", () => ({
  generateInvoiceLineItems: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import { generateInvoiceLineItems } from "../../src/services/invoice-generator.service.js";
import { NotFoundError, BadRequestError } from "../../src/lib/errors.js";

const mockGenerate = vi.mocked(generateInvoiceLineItems);

const JSON_ENDPOINT = "/api/invoices/generate-line-items";
const RUN = "/api/invoices/generate-line-items/run";

const okResult = {
  orderNumber: "ORD-1",
  alreadyPresent: false,
  materialLinesCreated: 2,
  laborLineCreated: true,
  adjustmentLineCreated: true,
  invoiceTotal: 140,
};

describe("GET /api/invoices/generate-line-items (Bearer JSON)", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("generates for the order and returns the summary with a valid bearer token", async () => {
    mockGenerate.mockResolvedValue(okResult);

    const res = await request(app)
      .get(`${JSON_ENDPOINT}?order=ORD-1`)
      .set("Authorization", "Bearer s3cret");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(okResult);
    expect(mockGenerate).toHaveBeenCalledWith("ORD-1");
  });

  it("returns 400 when the order query param is missing", async () => {
    const res = await request(app)
      .get(JSON_ENDPOINT)
      .set("Authorization", "Bearer s3cret");

    expect(res.status).toBe(400);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("maps a NotFoundError to 404", async () => {
    mockGenerate.mockRejectedValue(new NotFoundError("no order"));
    const res = await request(app)
      .get(`${JSON_ENDPOINT}?order=ORD-x`)
      .set("Authorization", "Bearer s3cret");
    expect(res.status).toBe(404);
  });

  it("maps a BadRequestError to 400", async () => {
    mockGenerate.mockRejectedValue(new BadRequestError("no invoice"));
    const res = await request(app)
      .get(`${JSON_ENDPOINT}?order=ORD-1`)
      .set("Authorization", "Bearer s3cret");
    expect(res.status).toBe(400);
  });

  it("returns 401 without a valid bearer token", async () => {
    const res = await request(app)
      .get(`${JSON_ENDPOINT}?order=ORD-1`)
      .set("Authorization", "Bearer nope");
    expect(res.status).toBe(401);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

describe("GET /api/invoices/generate-line-items/run (Notion link)", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("generates and returns an HTML confirmation for a valid query secret", async () => {
    mockGenerate.mockResolvedValue(okResult);

    const res = await request(app).get(`${RUN}?secret=s3cret&order=ORD-1`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Invoice itemized");
    expect(res.text).toContain("2 material lines");
    expect(res.text).toContain("$140.00");
  });

  it("reports when the invoice already had lines", async () => {
    mockGenerate.mockResolvedValue({
      ...okResult,
      alreadyPresent: true,
      materialLinesCreated: 0,
      laborLineCreated: false,
      adjustmentLineCreated: false,
      invoiceTotal: 0,
    });

    const res = await request(app).get(`${RUN}?secret=s3cret&order=ORD-1`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("already has line items");
  });

  it("shows the domain error message (HTML) for a bad request", async () => {
    mockGenerate.mockRejectedValue(
      new BadRequestError("This order has no costing items to itemize."),
    );

    const res = await request(app).get(`${RUN}?secret=s3cret&order=ORD-1`);
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("no costing items");
  });

  it("returns 400 (HTML) when no order is provided", async () => {
    const res = await request(app).get(`${RUN}?secret=s3cret`);
    expect(res.status).toBe(400);
    expect(res.text).toContain("Missing order");
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("returns 401 (HTML) for a wrong secret and does not run", async () => {
    const res = await request(app).get(`${RUN}?secret=nope&order=ORD-1`);
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Not authorized");
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("renders an HTML 500 page if the service throws unexpectedly", async () => {
    mockGenerate.mockRejectedValue(new Error("Notion is down"));

    const res = await request(app).get(`${RUN}?secret=s3cret&order=ORD-1`);
    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Something went wrong");
  });
});
