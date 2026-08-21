import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Notion repository so the HTTP stack (routing → validation → service →
// response schema parse → error handler) runs end-to-end without the network.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderByNumber: vi.fn(),
  createOrder: vi.fn(),
}));
vi.mock("../../src/lib/notion/invoice.repository.js", () => ({
  findInvoice: vi.fn(),
  listInvoiceLineItems: vi.fn(),
  markInvoicePaid: vi.fn(),
}));
vi.mock("../../src/lib/stripe/client.js", () => ({ getStripeClient: vi.fn() }));
// Referral capture is a best-effort side effect of order creation; mock it to
// assert the wiring and drive the failure branch without touching Notion/Stripe.
vi.mock("../../src/services/rewards.service.js", () => ({
  captureReferralOnOrder: vi.fn(),
}));

import request from "supertest";
import type Stripe from "stripe";
import { createOrderInput, orderRecord } from "@workspace/test-fixtures";
import app from "../../src/app.js";
import {
  findOrderByNumber,
  createOrder,
} from "../../src/lib/notion/orders.repository.js";
import { captureReferralOnOrder } from "../../src/services/rewards.service.js";
import {
  findInvoice,
  listInvoiceLineItems,
} from "../../src/lib/notion/invoice.repository.js";
import type { InvoiceRecord } from "../../src/lib/notion/invoice.schema.js";
import { getStripeClient } from "../../src/lib/stripe/client.js";

const mockFind = vi.mocked(findOrderByNumber);
const mockCreate = vi.mocked(createOrder);
const mockCapture = vi.mocked(captureReferralOnOrder);
const mockFindInvoice = vi.mocked(findInvoice);
const mockListLines = vi.mocked(listInvoiceLineItems);
const mockGetStripe = vi.mocked(getStripeClient);

const validBody = createOrderInput();

/** An invoice head with sane defaults; override per test. */
function invoiceHead(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    pageId: "inv-1",
    invoiceId: "Toothless",
    ready: true,
    balancePaid: false,
    deposits: [],
    ...overrides,
  };
}

function stubStripe(url = "https://checkout.stripe.test/pay") {
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

  it("includes the deposits + invoice breakdown once the invoice is ready", async () => {
    mockFind.mockResolvedValue({
      ...orderRecord({ orderNumber: "000002" }),
      pageId: "order-1",
      invoicePageId: "inv-1",
    });
    mockFindInvoice.mockResolvedValue(
      invoiceHead({
        deposits: [
          {
            stage: "first_deposit",
            label: "First deposit",
            amount: 100,
            paid: true,
          },
        ],
      }),
    );
    mockListLines.mockResolvedValue([
      { name: "Main fabric", type: "Material", amount: 40 },
      { name: "Construction", type: "Labor", amount: 120 },
    ]);

    const res = await request(app).get("/api/orders/000002");

    expect(res.status).toBe(200);
    expect(res.body.deposits).toEqual([
      {
        stage: "first_deposit",
        label: "First deposit",
        amount: 100,
        paid: true,
      },
    ]);
    expect(res.body.invoice).toEqual({
      invoiceId: "Toothless",
      paid: false,
      lineItems: [
        { name: "Main fabric", type: "Material", amount: 40 },
        { name: "Construction", type: "Labor", amount: 120 },
      ],
      subtotal: 160,
      depositsCreditedTotal: 100,
      balanceDue: 60,
    });
  });

  it("surfaces deposits but omits the invoice before Invoice Ready is flipped", async () => {
    mockFind.mockResolvedValue({
      ...orderRecord({ orderNumber: "000002" }),
      pageId: "order-1",
      invoicePageId: "inv-1",
    });
    mockFindInvoice.mockResolvedValue(
      invoiceHead({
        invoiceId: "Draft",
        ready: false,
        deposits: [
          {
            stage: "first_deposit",
            label: "First deposit",
            amount: 100,
            paid: false,
          },
        ],
      }),
    );

    const res = await request(app).get("/api/orders/000002");

    expect(res.status).toBe(200);
    expect(res.body.invoice).toBeUndefined();
    expect(res.body.deposits).toHaveLength(1);
  });
});

describe("POST /api/orders", () => {
  it("returns 201 with the new order number for a valid body", async () => {
    mockCreate.mockResolvedValue({
      orderNumber: "ORD-XYZ-987",
      pageId: "page-1",
    });

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
    mockCreate.mockResolvedValue({
      orderNumber: "ORD-APPT-001",
      pageId: "page-1",
    });
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

  it("accepts a service that asks for no measurements, without them", async () => {
    mockCreate.mockResolvedValue({
      orderNumber: "ORD-REP-001",
      pageId: "page-1",
    });
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
      .send({
        ...contact,
        service: "repairs",
        description: "Lost stones on the left shoulder",
      });

    // A repair is measured on the piece, in person — the values-or-appointment
    // rule that guards a commission must not apply to it.
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ orderNumber: "ORD-REP-001" });
  });

  it("returns 400 when a service worked on the customer's own piece carries no brief", async () => {
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
      .send({ ...contact, service: "repairs", description: "   " });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("holds an unknown service to the bespoke commission's rules", async () => {
    const {
      waist,
      bust,
      hips,
      height,
      bodyGirth,
      measurementUnit,
      ...contact
    } = validBody;

    // A retired or mistyped id must lose no gate: it resolves to the widest
    // service, which still needs measurements or an appointment.
    const res = await request(app)
      .post("/api/orders")
      .send({ ...contact, service: "embroidery" });

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("captures a referral code when one is supplied", async () => {
    mockCreate.mockResolvedValue({
      orderNumber: "ORD-REF-001",
      pageId: "page-1",
    });

    const res = await request(app)
      .post("/api/orders")
      .send({ ...validBody, referralCode: "AA-ABC123" });

    expect(res.status).toBe(201);
    expect(mockCapture).toHaveBeenCalledWith({
      referralCode: "AA-ABC123",
      email: validBody.email,
    });
  });

  it("does not attempt referral capture when no code is supplied", async () => {
    mockCreate.mockResolvedValue({
      orderNumber: "ORD-NOREF-001",
      pageId: "page-1",
    });
    await request(app).post("/api/orders").send(validBody);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("still creates the order (201) when referral capture throws", async () => {
    mockCreate.mockResolvedValue({
      orderNumber: "ORD-REF-002",
      pageId: "page-1",
    });
    mockCapture.mockRejectedValueOnce(new Error("capture boom"));

    const res = await request(app)
      .post("/api/orders")
      .send({ ...validBody, referralCode: "AA-ABC123" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ orderNumber: "ORD-REF-002" });
  });
});

describe("POST /api/orders/:orderNumber/payments/:stage", () => {
  function readyOrder() {
    return {
      ...orderRecord({ orderNumber: "000002" }),
      pageId: "order-1",
      invoicePageId: "inv-1",
    };
  }

  it("returns 201 { url } for a deposit that's due", async () => {
    mockFind.mockResolvedValue(readyOrder());
    mockFindInvoice.mockResolvedValue(
      invoiceHead({
        deposits: [
          {
            stage: "first_deposit",
            label: "First deposit",
            amount: 150,
            paid: false,
          },
        ],
      }),
    );
    stubStripe("https://checkout.stripe.test/abc");

    const res = await request(app).post(
      "/api/orders/000002/payments/first_deposit",
    );

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ url: "https://checkout.stripe.test/abc" });
  });

  it("returns 201 { url } for a balance that's due", async () => {
    mockFind.mockResolvedValue(readyOrder());
    mockFindInvoice.mockResolvedValue(
      invoiceHead({
        deposits: [
          {
            stage: "first_deposit",
            label: "First deposit",
            amount: 100,
            paid: true,
          },
        ],
      }),
    );
    mockListLines.mockResolvedValue([
      { name: "Main fabric", type: "Material", amount: 220 },
    ]);
    stubStripe("https://checkout.stripe.test/inv");

    const res = await request(app).post("/api/orders/000002/payments/balance");

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ url: "https://checkout.stripe.test/inv" });
  });

  it("returns 400 when the requested deposit has no amount set", async () => {
    mockFind.mockResolvedValue(readyOrder());
    mockFindInvoice.mockResolvedValue(invoiceHead({ deposits: [] }));
    const create = stubStripe();

    const res = await request(app).post(
      "/api/orders/000002/payments/second_deposit",
    );

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown payment stage (rejected by validation)", async () => {
    const create = stubStripe();

    const res = await request(app).post("/api/orders/000002/payments/bogus");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 404 when the order does not exist", async () => {
    mockFind.mockResolvedValue(null);

    const res = await request(app).post(
      "/api/orders/ORD-NOPE/payments/first_deposit",
    );

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("message");
  });
});
