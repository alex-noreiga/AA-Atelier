import { describe, it, expect, vi } from "vitest";

// Mock the repositories so the HTTP stack (routing → validation → service
// gates → response schema parse → error handler) runs end-to-end without the
// network. The service's gate logic runs for real.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderVerification: vi.fn(),
  updateOrderMeasurements: vi.fn(),
}));
vi.mock("../../src/services/measurement-change.service.js", () => ({
  submitMeasurementChangeRequest: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import {
  findOrderVerification,
  updateOrderMeasurements,
} from "../../src/lib/notion/orders.repository.js";
import { submitMeasurementChangeRequest } from "../../src/services/measurement-change.service.js";

const mockFind = vi.mocked(findOrderVerification);
const mockWrite = vi.mocked(updateOrderMeasurements);
const mockFile = vi.mocked(submitMeasurementChangeRequest);

const STAGES = ["Consultation", "Sketching", "Cutting/Pinning", "Delivery"];
const url = "/api/orders/000002/measurements";

const validBody = {
  email: "ada@example.com",
  waist: 26,
  bust: 34,
  hips: 36,
  height: 64,
  bodyGirth: 55,
  measurementUnit: "inches",
};

const order = (overrides: Record<string, unknown> = {}) => ({
  email: "ada@example.com",
  pageId: "page-order-test",
  orderName: "Ada – Custom Dress",
  currentStage: "Consultation",
  stages: STAGES,
  ...overrides,
});

describe("PUT /api/orders/:orderNumber/measurements", () => {
  it("returns 200 with the stored set when the email matches and it's pre-production", async () => {
    mockFind.mockResolvedValue(order());
    mockWrite.mockResolvedValue();

    const res = await request(app).put(url).send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      outcome: "applied",
      measurements: {
        unit: "inches",
        waist: 26,
        bust: 34,
        hips: 36,
        height: 64,
        bodyGirth: 55,
      },
    });
    expect(mockWrite).toHaveBeenCalledOnce();
  });

  it("returns 404 when the order does not exist", async () => {
    mockFind.mockResolvedValue(null);

    const res = await request(app).put(url).send(validBody);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("message");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 403 when the email doesn't match the order", async () => {
    mockFind.mockResolvedValue(order({ email: "someone-else@example.com" }));

    const res = await request(app).put(url).send(validBody);

    expect(res.status).toBe(403);
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockFile).not.toHaveBeenCalled();
  });

  it("returns 409 once the garment is in production", async () => {
    mockFind.mockResolvedValue(order({ currentStage: "Cutting/Pinning" }));

    const res = await request(app).put(url).send(validBody);

    expect(res.status).toBe(409);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("reports outcome=filed, not a failure, when the edit can't be written", async () => {
    mockFind.mockResolvedValue(order({ email: "" }));
    mockFile.mockResolvedValue({ received: true });

    const res = await request(app).put(url).send(validBody);

    expect(res.status).toBe(200);
    // No `measurements` on a filed edit: nothing changed, so returning a set
    // would tell the customer numbers are in force that aren't.
    expect(res.body).toEqual({ outcome: "filed" });
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("rejects a partial set — every value is required", async () => {
    mockFind.mockResolvedValue(order());
    const { bodyGirth: _dropped, ...partial } = validBody;

    const res = await request(app).put(url).send(partial);

    // A partial write would leave the atelier cutting to a mix of old and new
    // numbers, so the contract refuses one before any lookup happens.
    expect(res.status).toBe(400);
    expect(mockFind).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("rejects a zero or negative measurement", async () => {
    mockFind.mockResolvedValue(order());

    const res = await request(app)
      .put(url)
      .send({ ...validBody, waist: 0 });

    expect(res.status).toBe(400);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized unit rather than storing it", async () => {
    mockFind.mockResolvedValue(order());

    const res = await request(app)
      .put(url)
      .send({ ...validBody, measurementUnit: "hands" });

    expect(res.status).toBe(400);
    expect(mockWrite).not.toHaveBeenCalled();
  });
});
