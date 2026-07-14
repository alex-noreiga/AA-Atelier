import { describe, it, expect, vi } from "vitest";

// Mock both repositories so the HTTP stack (routing → validation → service
// gates → response schema parse → error handler) runs end-to-end without the
// network. The service's gate logic runs for real.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderForMeasurementChange: vi.fn(),
}));
vi.mock("../../src/lib/notion/measurement-change.repository.js", () => ({
  createMeasurementChangeRequest: vi.fn(),
}));

import request from "supertest";
import { measurementChangeInput } from "@workspace/test-fixtures";
import app from "../../src/app.js";
import { findOrderForMeasurementChange } from "../../src/lib/notion/orders.repository.js";
import { createMeasurementChangeRequest } from "../../src/lib/notion/measurement-change.repository.js";

const mockFind = vi.mocked(findOrderForMeasurementChange);
const mockWrite = vi.mocked(createMeasurementChangeRequest);

const STAGES = ["Consultation", "Sketching", "Cutting/Pinning", "Delivery"];
const url = "/api/orders/000002/measurement-change-requests";
const validBody = measurementChangeInput({ email: "ada@example.com" });

describe("POST /api/orders/:orderNumber/measurement-change-requests", () => {
  it("returns 201 when the email matches and the order is pre-production", async () => {
    mockFind.mockResolvedValue({
      email: "ada@example.com",
      currentStage: "Consultation",
      stages: STAGES,
    });
    mockWrite.mockResolvedValue();

    const res = await request(app).post(url).send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ received: true });
    expect(mockWrite).toHaveBeenCalledOnce();
  });

  it("returns 404 when the order does not exist", async () => {
    mockFind.mockResolvedValue(null);

    const res = await request(app).post(url).send(validBody);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("message");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 403 when the email doesn't match the order", async () => {
    mockFind.mockResolvedValue({
      email: "someone-else@example.com",
      currentStage: "Consultation",
      stages: STAGES,
    });

    const res = await request(app).post(url).send(validBody);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 409 when measurements are locked in production", async () => {
    mockFind.mockResolvedValue({
      email: "ada@example.com",
      currentStage: "Cutting/Pinning",
      stages: STAGES,
    });

    const res = await request(app).post(url).send(validBody);

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty("error");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 400 and never looks up the order for an invalid body", async () => {
    const res = await request(app)
      .post(url)
      .send({ ...validBody, email: "not-an-email", waist: -1 });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("returns 400 when neither measurements nor an appointment are provided", async () => {
    const res = await request(app)
      .post(url)
      .send({ email: "ada@example.com" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 201 for an appointment request with no measurement values", async () => {
    mockFind.mockResolvedValue({
      email: "ada@example.com",
      currentStage: "Consultation",
      stages: STAGES,
    });
    mockWrite.mockResolvedValue();

    const res = await request(app)
      .post(url)
      .send({ email: "ada@example.com", measurementAppointment: true });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ received: true });
    expect(mockWrite).toHaveBeenCalledOnce();
  });
});
