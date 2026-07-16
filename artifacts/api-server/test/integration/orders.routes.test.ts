import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Notion repository so the HTTP stack (routing → validation → service →
// response schema parse → error handler) runs end-to-end without the network.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderByNumber: vi.fn(),
  createOrder: vi.fn(),
  findDepositTarget: vi.fn(),
  markDepositPaid: vi.fn(),
}));
vi.mock("../../src/lib/notion/invoice.repository.js", () => ({
  findInvoice: vi.fn(),
  listInvoiceLineItems: vi.fn(),
  markBalancePaid: vi.fn(),
}));
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
import {
  findInvoice,
  listInvoiceLineItems,
} from "../../src/lib/notion/invoice.repository.js";
import { getStripeClient } from "../../src/lib/stripe/client.js";

const mockFind = vi.mocked(findOrderByNumber);
const mockCreate = vi.mocked(createOrder);
const mockFindDeposit = vi.mocked(findDepositTarget);
const mockFindInvoice = vi.mocked(findInvoice);
const mockListLines = vi.mocked(listInvoiceLineItems);
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
      measurementsLocked: false,
    });
  });

  it("surfaces the production lock and estimated completion date", async () => {
    mockFind.mockResolvedValue(
      orderRecord({
        orderNumber: "000003",
        currentStage: "Cutting/Pinning",
        stages: ["Consultation", "Cutting/Pinning", "Delivery"],
        estimatedCompletion: "2026-08-01",
      }),
    );

    const res = await request(app).get("/api/orders/000003");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      orderNumber: "000003",
      orderName: "Ada – Custom Dress",
      currentStage: "Cutting/Pinning",
      stages: ["Consultation", "Cutting/Pinning", "Delivery"],
      measurementsLocked: true,
      estimatedCompletion: "2026-08-01",
    });
  });

  it("returns 404 with a message when the order is missing (async error is forwarded to the handler)", async () => {
    mockFind.mockResolvedValue(null);

    const res = await request(app).get("/api/orders/ORD-NOPE");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("message");
  });

  it("includes the invoice breakdown once the invoice is ready", async () => {
    mockFind.mockResolvedValue({
      ...orderRecord({ orderNumber: "000002" }),
      pageId: "order-1",
      invoicePageId: "inv-1",
      depositAmount: 100,
      depositPaid: true,
    });
    mockFindInvoice.mockResolvedValue({
      pageId: "inv-1",
      invoiceId: "Toothless",
      ready: true,
      balancePaid: false,
    });
    mockListLines.mockResolvedValue([
      { name: "Main fabric", type: "Material", amount: 40 },
      { name: "Construction", type: "Labor", amount: 120 },
    ]);

    const res = await request(app).get("/api/orders/000002");

    expect(res.status).toBe(200);
    expect(res.body.invoice).toEqual({
      invoiceId: "Toothless",
      paid: false,
      lineItems: [
        { name: "Main fabric", type: "Material", amount: 40 },
        { name: "Construction", type: "Labor", amount: 120 },
      ],
      deposits: [{ label: "Deposit 1", amount: 100, paid: true }],
      subtotal: 160,
      depositsCreditedTotal: 100,
      balanceDue: 60,
    });
  });

  it("omits the invoice when the atelier hasn't flipped Invoice Ready", async () => {
    mockFind.mockResolvedValue({
      ...orderRecord({ orderNumber: "000002" }),
      pageId: "order-1",
      invoicePageId: "inv-1",
    });
    mockFindInvoice.mockResolvedValue({
      pageId: "inv-1",
      invoiceId: "Draft",
      ready: false,
      balancePaid: false,
    });

    const res = await request(app).get("/api/orders/000002");

    expect(res.status).toBe(200);
    expect(res.body.invoice).toBeUndefined();
  });
});

describe("POST /api/orders", () => {
  it("returns 201 with the new order number for a valid body", async () => {
    mockCreate.mockResolvedValue("ORD-XYZ-987");

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
    mockCreate.mockResolvedValue("ORD-APPT-001");
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

describe("POST /api/orders/:orderNumber/invoice", () => {
  function readyOrder() {
    return {
      ...orderRecord({ orderNumber: "000002" }),
      pageId: "order-1",
      invoicePageId: "inv-1",
      depositAmount: 100,
      depositPaid: true,
    };
  }

  it("returns 201 { url } when a balance is due", async () => {
    mockFind.mockResolvedValue(readyOrder());
    mockFindInvoice.mockResolvedValue({
      pageId: "inv-1",
      invoiceId: "Toothless",
      ready: true,
      balancePaid: false,
    });
    mockListLines.mockResolvedValue([
      { name: "Main fabric", type: "Material", amount: 220 },
    ]);
    stubStripe("https://checkout.stripe.test/inv");

    const res = await request(app).post("/api/orders/000002/invoice");

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ url: "https://checkout.stripe.test/inv" });
  });

  it("returns 400 when the invoice isn't ready", async () => {
    mockFind.mockResolvedValue(readyOrder());
    mockFindInvoice.mockResolvedValue({
      pageId: "inv-1",
      invoiceId: "Draft",
      ready: false,
      balancePaid: false,
    });
    const create = stubStripe();

    const res = await request(app).post("/api/orders/000002/invoice");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 404 when the order does not exist", async () => {
    mockFind.mockResolvedValue(null);

    const res = await request(app).post("/api/orders/ORD-NOPE/invoice");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("message");
  });
});
