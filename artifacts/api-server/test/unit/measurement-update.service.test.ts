import { describe, it, expect, vi } from "vitest";

// Mock the repositories, the change-request fallback, and the email transport.
// The gates — which are the whole point of this service — run for real.
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

import { updateMeasurements } from "../../src/services/measurement-update.service.js";
import {
  findOrderVerification,
  updateOrderMeasurements,
} from "../../src/lib/notion/orders.repository.js";
import { submitMeasurementChangeRequest } from "../../src/services/measurement-change.service.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import {
  NotFoundError,
  ForbiddenError,
  MeasurementsLockedError,
  MeasurementPropertiesMissingError,
} from "../../src/lib/errors.js";

const mockFind = vi.mocked(findOrderVerification);
const mockWrite = vi.mocked(updateOrderMeasurements);
const mockFile = vi.mocked(submitMeasurementChangeRequest);
const mockSend = vi.mocked(sendEmailBestEffort);

// Stages ordered so "Cutting/Pinning" (the default lock point) sits mid-list.
const STAGES = ["Consultation", "Sketching", "Cutting/Pinning", "Delivery"];

const order = (overrides: Record<string, unknown> = {}) => ({
  email: "ada@example.com",
  pageId: "page-order-test",
  orderName: "Ada – Custom Dress",
  currentStage: "Consultation",
  stages: STAGES,
  measurements: { unit: "inches" as const, waist: 25, bust: 34 },
  ...overrides,
});

const input = {
  email: "ada@example.com",
  waist: 26,
  bust: 34,
  hips: 36,
  height: 64,
  bodyGirth: 55,
  measurementUnit: "inches" as const,
};

describe("updateMeasurements gates", () => {
  it("writes the values onto the order when the email matches and it's pre-production", async () => {
    mockFind.mockResolvedValue(order());

    const result = await updateMeasurements("000002", input);

    expect(result).toEqual({
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
    const [pageId, values, revision] = mockWrite.mock.calls[0];
    expect(pageId).toBe("page-order-test");
    expect(values).toMatchObject({ waist: 26, measurementUnit: "inches" });
    // The values that were on file ride along so the revision note can say
    // what each one was.
    expect(revision.previous).toEqual({ unit: "inches", waist: 25, bust: 34 });
    expect(mockFile).not.toHaveBeenCalled();
  });

  it("throws NotFound for an unknown order, touching nothing", async () => {
    mockFind.mockResolvedValue(null);

    await expect(updateMeasurements("nope", input)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockFile).not.toHaveBeenCalled();
  });

  it("refuses an email that contradicts the one on the order", async () => {
    mockFind.mockResolvedValue(order({ email: "someone-else@example.com" }));

    await expect(updateMeasurements("000002", input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // Refused outright rather than filed: this is someone else's order, so
    // there is nothing to pass to the atelier.
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockFile).not.toHaveBeenCalled();
  });

  it("matches the email case- and whitespace-insensitively", async () => {
    mockFind.mockResolvedValue(order({ email: "Ada@Example.com " }));

    await updateMeasurements("000002", { ...input, email: " ADA@example.COM" });

    expect(mockWrite).toHaveBeenCalledOnce();
  });

  it("refuses once the garment has reached the production lock stage", async () => {
    mockFind.mockResolvedValue(order({ currentStage: "Cutting/Pinning" }));

    await expect(updateMeasurements("000002", input)).rejects.toBeInstanceOf(
      MeasurementsLockedError,
    );
    expect(mockWrite).not.toHaveBeenCalled();
    // Deliberately not filed either: past the lock a change request would be
    // refused too, so the answer is the same one either way.
    expect(mockFile).not.toHaveBeenCalled();
  });

  it("checks the lock before the unverifiable-order fallback", async () => {
    // A legacy order that is ALSO in production must get the lock answer,
    // not a filed request that would itself be refused.
    mockFind.mockResolvedValue(
      order({ email: "", currentStage: "Cutting/Pinning" }),
    );

    await expect(updateMeasurements("000002", input)).rejects.toBeInstanceOf(
      MeasurementsLockedError,
    );
    expect(mockFile).not.toHaveBeenCalled();
  });
});

describe("updateMeasurements fallbacks", () => {
  it("files a change request instead of writing when the order has no email to verify against", async () => {
    mockFind.mockResolvedValue(order({ email: "" }));

    const result = await updateMeasurements("000002", {
      ...input,
      note: " check the waist ",
    });

    // The write is what must not happen — an order nobody can be verified
    // against is exactly the case a human should vet.
    expect(mockWrite).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: "filed" });
    expect(mockFile).toHaveBeenCalledWith("000002", {
      email: "ada@example.com",
      waist: 26,
      bust: 34,
      hips: 36,
      height: 64,
      bodyGirth: 55,
      measurementUnit: "inches",
      note: "check the waist",
    });
  });

  it("files a change request when the database has nowhere to store the values", async () => {
    mockFind.mockResolvedValue(order());
    mockWrite.mockRejectedValueOnce(
      new MeasurementPropertiesMissingError("Body Girth"),
    );

    const result = await updateMeasurements("000002", input);

    // Reporting a save here would tell the customer their measurements are on
    // file when the atelier would still cut to the old ones.
    expect(result).toEqual({ outcome: "filed" });
    expect(mockFile).toHaveBeenCalledOnce();
  });

  it("does not swallow an unrelated write failure", async () => {
    mockFind.mockResolvedValue(order());
    mockWrite.mockRejectedValueOnce(new Error("Notion 500"));

    await expect(updateMeasurements("000002", input)).rejects.toThrow(
      "Notion 500",
    );
    expect(mockFile).not.toHaveBeenCalled();
  });
});

describe("updateMeasurements notifications", () => {
  it("emails the customer a copy of what is now on file", async () => {
    mockFind.mockResolvedValue(order());

    await updateMeasurements("000002", input);

    const customer = mockSend.mock.calls
      .map(([message]) => message)
      .find((message) => message.to === "ada@example.com");
    expect(customer).toBeDefined();
    // The receipt is the tripwire on a write nobody reviewed, so it must show
    // the change rather than only confirming that something happened.
    expect(customer?.text).toContain("Waist: 26 (was 25)");
    expect(customer?.subject).toContain("000002");
  });

  it("tells the atelier which stage the order was at when it changed", async () => {
    process.env.ATELIER_INBOX_EMAIL = "studio@example.com";
    mockFind.mockResolvedValue(order({ currentStage: "Sketching" }));

    try {
      await updateMeasurements("000002", input);
    } finally {
      delete process.env.ATELIER_INBOX_EMAIL;
    }

    const notification = mockSend.mock.calls
      .map(([message]) => message)
      .find((message) => message.to === "studio@example.com");
    expect(notification).toBeDefined();
    // Unlike a change request this is not a task — the values are already
    // stored — so what the atelier needs is whether any work has been done to
    // the old numbers.
    expect(notification?.text).toContain("Current stage: Sketching");
    expect(notification?.text).toContain("Waist 25 → 26");
    expect(notification?.replyTo).toBe("ada@example.com");
  });

  it("sends no customer receipt when the edit was only filed", async () => {
    mockFind.mockResolvedValue(order({ email: "" }));

    await updateMeasurements("000002", input);

    // The change-request flow sends its own acknowledgement; a second email
    // claiming the measurements are updated would be untrue.
    expect(mockSend).not.toHaveBeenCalled();
  });
});
