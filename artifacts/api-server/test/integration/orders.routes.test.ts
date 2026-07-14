import { describe, it, expect, vi } from "vitest";

// Mock the Notion repository so the HTTP stack (routing → validation → service →
// response schema parse → error handler) runs end-to-end without the network.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderByNumber: vi.fn(),
  createOrder: vi.fn(),
}));

import request from "supertest";
import { createOrderInput, orderRecord } from "@workspace/test-fixtures";
import app from "../../src/app.js";
import {
  findOrderByNumber,
  createOrder,
} from "../../src/lib/notion/orders.repository.js";

const mockFind = vi.mocked(findOrderByNumber);
const mockCreate = vi.mocked(createOrder);

const validBody = createOrderInput();

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
