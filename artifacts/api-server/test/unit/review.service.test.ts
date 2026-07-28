import { describe, it, expect, vi, afterEach } from "vitest";
import { reviewInput } from "@workspace/test-fixtures";

// Mock the order lookup (identity + delivery source), the reviews writer, the
// CRM upsert, and the email transport. The gate logic runs for real between them.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderVerification: vi.fn(),
}));
vi.mock("../../src/lib/notion/reviews.repository.js", () => ({
  createReview: vi.fn(),
}));
vi.mock("../../src/lib/notion/clients.repository.js", () => ({
  upsertClientByEmail: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import { submitOrderReview } from "../../src/services/review.service.js";
import { findOrderVerification } from "../../src/lib/notion/orders.repository.js";
import { createReview } from "../../src/lib/notion/reviews.repository.js";
import { upsertClientByEmail } from "../../src/lib/notion/clients.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from "../../src/lib/errors.js";

const mockFind = vi.mocked(findOrderVerification);
const mockWrite = vi.mocked(createReview);
const mockUpsertClient = vi.mocked(upsertClientByEmail);
const mockSend = vi.mocked(sendEmailBestEffort);

const STAGES = ["Consultation", "Sketching", "Cutting/Pinning", "Delivery"];

/** A delivered order (final stage) whose email matches the fixture by default. */
const delivered = (email = "ada@example.com") => ({
  email,
  currentStage: "Delivery",
  stages: STAGES,
});

afterEach(() => {
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.ATELIER_INBOX_EMAIL;
});

describe("submitOrderReview — delivery gate", () => {
  it("throws NotFoundError when the order does not exist", async () => {
    mockFind.mockResolvedValue(null);
    await expect(
      submitOrderReview("ORD-NOPE", reviewInput()),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("throws ConflictError (and never writes) when the order isn't delivered", async () => {
    mockFind.mockResolvedValue({
      email: "ada@example.com",
      currentStage: "Sketching",
      stages: STAGES,
    });
    await expect(
      submitOrderReview("000002", reviewInput()),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("files the review once the order is at its final stage", async () => {
    mockFind.mockResolvedValue(delivered());
    const result = await submitOrderReview("  000002  ", reviewInput());
    expect(result).toEqual({ received: true });
    expect(mockWrite).toHaveBeenCalledOnce();
    expect(mockWrite.mock.calls[0][0].orderNumber).toBe("000002");
  });
});

describe("submitOrderReview — identity gate", () => {
  it("throws ForbiddenError when the email doesn't match", async () => {
    mockFind.mockResolvedValue(delivered("someone-else@example.com"));
    await expect(
      submitOrderReview("000002", reviewInput({ email: "ada@example.com" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("marks the review verified when the email matches (case-insensitively)", async () => {
    mockFind.mockResolvedValue(delivered("Ada@Example.com"));
    await submitOrderReview(
      "000002",
      reviewInput({ email: "ada@example.com" }),
    );
    expect(mockWrite.mock.calls[0][0].emailVerified).toBe(true);
  });

  it("accepts a legacy order (no stored email) but flags it unverified", async () => {
    mockFind.mockResolvedValue({
      email: "",
      currentStage: "Delivery",
      stages: STAGES,
    });
    await submitOrderReview("000002", reviewInput());
    expect(mockWrite).toHaveBeenCalledOnce();
    expect(mockWrite.mock.calls[0][0].emailVerified).toBe(false);
  });
});

describe("submitOrderReview — CRM link", () => {
  it("links the review to the customer's Client CRM record (dedupe by email)", async () => {
    mockFind.mockResolvedValue(delivered());
    mockUpsertClient.mockResolvedValue("client-9");

    await submitOrderReview(
      "000002",
      reviewInput({ email: "ada@example.com", displayName: "Ada L." }),
    );

    expect(mockUpsertClient).toHaveBeenCalledWith({
      fullName: "Ada L.",
      email: "ada@example.com",
    });
    // The resolved client page id is threaded into the review write.
    expect(mockWrite.mock.calls[0][2]).toBe("client-9");
  });

  it("still files the review when the CRM upsert fails", async () => {
    mockFind.mockResolvedValue(delivered());
    mockUpsertClient.mockRejectedValue(new Error("crm down"));
    const result = await submitOrderReview("000002", reviewInput());
    expect(result).toEqual({ received: true });
    expect(mockWrite).toHaveBeenCalledOnce();
    expect(mockWrite.mock.calls[0][2]).toBeUndefined();
  });
});

describe("submitOrderReview — emails", () => {
  it("thanks the customer (from the orders sender) after filing", async () => {
    process.env.RESEND_FROM_EMAIL = "A.A Atelier <orders@a3iceanddance.com>";
    mockFind.mockResolvedValue(delivered());

    await submitOrderReview(
      "000002",
      reviewInput({ email: "ada@example.com" }),
    );

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][0].to).toBe("ada@example.com");
    expect(mockSend.mock.calls[0][0].from).toBe(
      "A.A Atelier <orders@a3iceanddance.com>",
    );
  });

  it("also notifies the atelier inbox (reply-to the customer) when configured", async () => {
    process.env.ATELIER_INBOX_EMAIL = "orders@a3iceanddance.com";
    mockFind.mockResolvedValue(delivered());

    await submitOrderReview(
      "000002",
      reviewInput({ email: "ada@example.com" }),
    );

    expect(mockSend).toHaveBeenCalledTimes(2);
    const notification = mockSend.mock.calls
      .map((c) => c[0])
      .find((m) => m.to === "orders@a3iceanddance.com");
    expect(notification?.replyTo).toBe("ada@example.com");
  });

  it("sends no atelier notification when no inbox is configured", async () => {
    mockFind.mockResolvedValue(delivered());
    await submitOrderReview("000002", reviewInput());
    expect(mockSend).toHaveBeenCalledOnce();
  });
});
