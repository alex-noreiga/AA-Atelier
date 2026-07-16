import { describe, it, expect, vi, afterEach } from "vitest";
import { measurementChangeInput } from "@workspace/test-fixtures";

// Mock the two repositories and the email transport the service depends on: the
// order lookup (identity + stage source), the inbox writer, and best-effort
// send. The gates run for real between them.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderForMeasurementChange: vi.fn(),
}));
vi.mock("../../src/lib/notion/measurement-change.repository.js", () => ({
  createMeasurementChangeRequest: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import { submitMeasurementChangeRequest } from "../../src/services/measurement-change.service.js";
import { findOrderForMeasurementChange } from "../../src/lib/notion/orders.repository.js";
import { createMeasurementChangeRequest } from "../../src/lib/notion/measurement-change.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import {
  NotFoundError,
  ForbiddenError,
  MeasurementsLockedError,
  ValidationError,
} from "../../src/lib/errors.js";

const mockFind = vi.mocked(findOrderForMeasurementChange);
const mockWrite = vi.mocked(createMeasurementChangeRequest);
const mockSend = vi.mocked(sendEmailBestEffort);

// Stages ordered so "Cutting/Pinning" (the default lock point) sits mid-list.
const STAGES = ["Consultation", "Sketching", "Cutting/Pinning", "Delivery"];

const preProduction = (email = "ada@example.com") => ({
  email,
  currentStage: "Consultation",
  stages: STAGES,
});

afterEach(() => {
  delete process.env.MEASUREMENT_LOCK_FROM_STAGE;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.ATELIER_INBOX_EMAIL;
});

describe("submitMeasurementChangeRequest — identity gate", () => {
  it("throws NotFoundError when the order does not exist", async () => {
    mockFind.mockResolvedValue(null);
    await expect(
      submitMeasurementChangeRequest("ORD-NOPE", measurementChangeInput()),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError and never writes when the email doesn't match", async () => {
    mockFind.mockResolvedValue({
      email: "someone-else@example.com",
      currentStage: "Consultation",
      stages: STAGES,
    });
    await expect(
      submitMeasurementChangeRequest(
        "000002",
        measurementChangeInput({ email: "ada@example.com" }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("files the request marked verified when the email matches (case-insensitively)", async () => {
    mockFind.mockResolvedValue({
      email: "Ada@Example.com",
      currentStage: "Consultation",
      stages: STAGES,
    });

    const result = await submitMeasurementChangeRequest(
      "  000002  ",
      measurementChangeInput({ email: "ada@example.com" }),
    );

    expect(result).toEqual({ received: true });
    expect(mockWrite).toHaveBeenCalledOnce();
    const row = mockWrite.mock.calls[0][0];
    expect(row.orderNumber).toBe("000002");
    expect(row.emailVerified).toBe(true);
  });

  it("accepts a legacy order (no stored email) but flags it unverified", async () => {
    mockFind.mockResolvedValue({
      email: "",
      currentStage: "Consultation",
      stages: STAGES,
    });

    await submitMeasurementChangeRequest("000002", measurementChangeInput());

    expect(mockWrite).toHaveBeenCalledOnce();
    expect(mockWrite.mock.calls[0][0].emailVerified).toBe(false);
  });
});

describe("submitMeasurementChangeRequest — production lock", () => {
  it("allows a change before the lock stage", async () => {
    mockFind.mockResolvedValue({
      email: "ada@example.com",
      currentStage: "Sketching",
      stages: STAGES,
    });
    await submitMeasurementChangeRequest("000002", measurementChangeInput());
    expect(mockWrite).toHaveBeenCalledOnce();
  });

  it("throws MeasurementsLockedError at the lock stage", async () => {
    mockFind.mockResolvedValue({
      email: "ada@example.com",
      currentStage: "Cutting/Pinning",
      stages: STAGES,
    });
    await expect(
      submitMeasurementChangeRequest("000002", measurementChangeInput()),
    ).rejects.toBeInstanceOf(MeasurementsLockedError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("throws MeasurementsLockedError past the lock stage", async () => {
    mockFind.mockResolvedValue({
      email: "ada@example.com",
      currentStage: "Delivery",
      stages: STAGES,
    });
    await expect(
      submitMeasurementChangeRequest("000002", measurementChangeInput()),
    ).rejects.toBeInstanceOf(MeasurementsLockedError);
  });

  it("fails open (allows) when the current stage isn't in the live list", async () => {
    mockFind.mockResolvedValue({
      email: "ada@example.com",
      currentStage: "Some Renamed Stage",
      stages: STAGES,
    });
    await submitMeasurementChangeRequest("000002", measurementChangeInput());
    expect(mockWrite).toHaveBeenCalledOnce();
  });

  it("honours the MEASUREMENT_LOCK_FROM_STAGE override", async () => {
    process.env.MEASUREMENT_LOCK_FROM_STAGE = "Sketching";
    mockFind.mockResolvedValue({
      email: "ada@example.com",
      currentStage: "Sketching",
      stages: STAGES,
    });
    await expect(
      submitMeasurementChangeRequest("000002", measurementChangeInput()),
    ).rejects.toBeInstanceOf(MeasurementsLockedError);
  });
});

describe("submitMeasurementChangeRequest — values-or-appointment rule", () => {
  it("rejects a request with neither measurements nor an appointment (before any lookup)", async () => {
    await expect(
      submitMeasurementChangeRequest("000002", { email: "ada@example.com" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockFind).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("files an appointment request with no measurement values", async () => {
    mockFind.mockResolvedValue(preProduction());

    const result = await submitMeasurementChangeRequest("000002", {
      email: "ada@example.com",
      measurementAppointment: true,
    });

    expect(result).toEqual({ received: true });
    expect(mockWrite).toHaveBeenCalledOnce();
    expect(mockWrite.mock.calls[0][0].request.measurementAppointment).toBe(
      true,
    );
  });
});

describe("submitMeasurementChangeRequest — emails", () => {
  it("confirms to the customer (from the orders sender) after filing", async () => {
    process.env.RESEND_FROM_EMAIL = "A.A Atelier <orders@a3iceanddance.com>";
    mockFind.mockResolvedValue(preProduction());

    await submitMeasurementChangeRequest(
      "000002",
      measurementChangeInput({ email: "ada@example.com" }),
    );

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][0].to).toBe("ada@example.com");
    expect(mockSend.mock.calls[0][0].from).toBe(
      "A.A Atelier <orders@a3iceanddance.com>",
    );
  });

  it("also notifies the atelier inbox (reply-to the customer) when configured", async () => {
    process.env.ATELIER_INBOX_EMAIL = "orders@a3iceanddance.com";
    mockFind.mockResolvedValue(preProduction());

    await submitMeasurementChangeRequest(
      "000002",
      measurementChangeInput({ email: "ada@example.com" }),
    );

    expect(mockSend).toHaveBeenCalledTimes(2);
    const notification = mockSend.mock.calls
      .map((c) => c[0])
      .find((m) => m.to === "orders@a3iceanddance.com");
    expect(notification?.replyTo).toBe("ada@example.com");
  });

  it("sends no atelier notification when no inbox is configured", async () => {
    mockFind.mockResolvedValue(preProduction());
    await submitMeasurementChangeRequest("000002", measurementChangeInput());
    expect(mockSend).toHaveBeenCalledOnce();
  });
});
