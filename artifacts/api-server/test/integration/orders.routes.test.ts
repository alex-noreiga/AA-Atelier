import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Notion repository so the HTTP stack (routing → validation → service →
// response schema parse → error handler) runs end-to-end without the network.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderByNumber: vi.fn(),
  createOrder: vi.fn(),
  findDepositTarget: vi.fn(),
  markDepositPaid: vi.fn(),
}));
vi.mock("../../src/lib/notion/invoices.repository.js", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../../src/lib/notion/invoices.repository.js")
    >();
  return { ...actual, findInvoiceById: vi.fn(), markBalancePaid: vi.fn() };
});
vi.mock("../../src/lib/stripe/client.js", () => ({ getStripeClient: vi.fn() }));

import request from "supertest";
import type Stripe from "stripe";
import { createOrderInput, orderRecord } from "@workspace/test-fixtures";
import app from "../../src/app.js";
import {
  findOrderByNumber,
  createOrder,
  findDepositTarget,
} from "../../src/lib/notion/orders.repository.js";
import { findInvoiceById } from "../../src/lib/notion/invoices.repository.js";
import { getStripeClient } from "../../src/lib/stripe/client.js";

const mockFind = vi.mocked(findOrderByNumber);
const mockCreate = vi.mocked(createOrder);
const mockFindDeposit = vi.mocked(findDepositTarget);
const mockFindInvoice = vi.mocked(findInvoiceById);
const mockGetStripe = vi.mocked(getStripeClient);

const validBody = createOrderInput();

function stubStripe(url = "https://checkout.stripe.test/deposit") {
  const create = vi.fn().mockResolvedValue({ url });
  mockGetStripe.mockReturnValue({
    checkout: { sessions: { create } },
  } as unknown as Stripe);
  return create;
}

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = "https://shop.test";
});

describe("GET /api/orders/:orderNumber", () => {
  it("returns 200 with the order status payload", async () => {
    // Stub input only — the expectation below stays written out by hand so the
    // route is asserted against an independent literal, not against the very
    // fixture it was fed (see the guardrail in @workspace/test-fixtures).
    mockFind.mockResolvedValue(
      orderRecord({
        orderNumber: "000002",
        currentStage: "Sewing",
        stages: ["Consultation", "Sewing", "Delivery"],
      }),
    );

    const res = await request(app).get("/api/orders/000002");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      orderNumber: "000002",
      orderName: "Ada – Custom Dress",
      currentStage: "Sewing",
      stages: ["Consultation", "Sewing", "Delivery"],
    });
  });

  it("returns 404 with a message when the order is missing (async error is forwarded to the handler)", async () => {
    mockFind.mockResolvedValue(null);

    const res = await request(app).get("/api/orders/ORD-NOPE");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("message");
  });
});

describe("POST /api/orders", () => {
  it("returns 201 with the new order number for a valid body", async () => {
    mockCreate.mockResolvedValue({ orderNumber: "ORD-XYZ-987", pageId: "p1" });

    const res = await request(app).post("/api/orders").send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ orderNumber: "ORD-XYZ-987" });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("returns 400 and never touches the repository for an invalid body", async () => {
    const res = await request(app)
      .post("/api/orders")
      .send({ ...validBody, email: "not-an-email", waist: -1 });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 201 for a measurement-appointment order with no measurements", async () => {
    mockCreate.mockResolvedValue({ orderNumber: "ORD-APPT-001", pageId: "p2" });
    const {
      waist,
      bust,
      hips,
      height,
      bodyGirth,
      measurementUnit,
      ...contact
    } = validBody;

    const res = await request(app)
      .post("/api/orders")
      .send({ ...contact, measurementAppointment: true });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ orderNumber: "ORD-APPT-001" });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("returns 400 when neither measurements nor an appointment are provided", async () => {
    const {
      waist,
      bust,
      hips,
      height,
      bodyGirth,
      measurementUnit,
      ...contact
    } = validBody;

    const res = await request(app).post("/api/orders").send(contact);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/orders/:orderNumber/deposit", () => {
  it("returns 201 { url } when a deposit is due", async () => {
    mockFindDeposit.mockResolvedValue({
      pageId: "page-42",
      orderName: "Ada – Custom Dress",
      depositAmount: 150,
      depositPaid: false,
    });
    stubStripe("https://checkout.stripe.test/abc");

    const res = await request(app).post("/api/orders/000002/deposit");

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ url: "https://checkout.stripe.test/abc" });
  });

  it("returns 400 when no deposit has been set on the order", async () => {
    mockFindDeposit.mockResolvedValue({
      pageId: "page-42",
      orderName: "Ada",
      depositPaid: false,
    });
    const create = stubStripe();

    const res = await request(app).post("/api/orders/000002/deposit");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 404 when the order does not exist", async () => {
    mockFindDeposit.mockResolvedValue(null);

    const res = await request(app).post("/api/orders/ORD-NOPE/deposit");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("message");
  });
});

describe("POST /api/orders/:orderNumber/balance", () => {
  it("returns 201 { url } when a ready invoice has a balance due", async () => {
    mockFindDeposit.mockResolvedValue({
      pageId: "page-42",
      orderName: "Ada – Custom Dress",
      depositAmount: 200,
      depositPaid: true,
      invoicePageId: "inv-1",
    });
    mockFindInvoice.mockResolvedValue({
      finalBalance: 800,
      balancePaid: false,
      invoiceReady: true,
    });
    stubStripe("https://checkout.stripe.test/bal");

    const res = await request(app).post("/api/orders/000002/balance");

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ url: "https://checkout.stripe.test/bal" });
  });

  it("returns 400 when the invoice isn't ready", async () => {
    mockFindDeposit.mockResolvedValue({
      pageId: "page-42",
      orderName: "Ada",
      depositPaid: true,
      invoicePageId: "inv-1",
    });
    mockFindInvoice.mockResolvedValue({
      finalBalance: 800,
      balancePaid: false,
      invoiceReady: false,
    });
    const create = stubStripe();

    const res = await request(app).post("/api/orders/000002/balance");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 404 when the order does not exist", async () => {
    mockFindDeposit.mockResolvedValue(null);

    const res = await request(app).post("/api/orders/ORD-NOPE/balance");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("message");
  });
});
