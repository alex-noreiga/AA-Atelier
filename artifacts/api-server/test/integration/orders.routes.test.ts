import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Notion repository so the HTTP stack (routing → validation → service →
// response schema parse → error handler) runs end-to-end without the network.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderByNumber: vi.fn(),
  createOrder: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import {
  findOrderByNumber,
  createOrder,
} from "../../src/lib/notion/orders.repository.js";

const mockFind = vi.mocked(findOrderByNumber);
const mockCreate = vi.mocked(createOrder);

const validBody = {
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+1 555 000 1234",
  preferredContact: "email",
  measurementUnit: "inches",
  waist: 28,
  bust: 36,
  hips: 38,
  height: 65,
  bodyGirth: 32,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/orders/:orderNumber", () => {
  it("returns 200 with the order status payload", async () => {
    mockFind.mockResolvedValue({
      orderNumber: "000002",
      orderName: "Ada – Custom Dress",
      currentStage: "Sewing",
      stages: ["Consultation", "Sewing", "Delivery"],
    });

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
});
