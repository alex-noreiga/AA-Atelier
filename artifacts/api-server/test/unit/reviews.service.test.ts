import { describe, it, expect, vi, afterEach } from "vitest";
import { reviewInput } from "@workspace/test-fixtures";

// Mock the order lookup (identity source), the reviews writer, and the email
// transport. The identity gate runs for real between them.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderForMeasurementChange: vi.fn(),
}));
vi.mock("../../src/lib/notion/reviews.repository.js", () => ({
  createReview: vi.fn(),
  listPublishedReviews: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import {
  submitReview,
  listReviews,
} from "../../src/services/reviews.service.js";
import { findOrderForMeasurementChange } from "../../src/lib/notion/orders.repository.js";
import {
  createReview,
  listPublishedReviews,
} from "../../src/lib/notion/reviews.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import { NotFoundError, ForbiddenError } from "../../src/lib/errors.js";

const mockFind = vi.mocked(findOrderForMeasurementChange);
const mockWrite = vi.mocked(createReview);
const mockList = vi.mocked(listPublishedReviews);
const mockSend = vi.mocked(sendEmailBestEffort);

const STAGES = ["Consultation", "Delivery"];
const order = (email = "ada@example.com") => ({
  email,
  currentStage: "Consultation",
  stages: STAGES,
});

afterEach(() => {
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.ATELIER_INBOX_EMAIL;
});

describe("submitReview — identity gate", () => {
  it("throws NotFoundError and never writes when the order does not exist", async () => {
    mockFind.mockResolvedValue(null);
    await expect(submitReview(reviewInput())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError and never writes when the email doesn't match", async () => {
    mockFind.mockResolvedValue(order("someone-else@example.com"));
    await expect(
      submitReview(reviewInput({ email: "ada@example.com" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("files the review marked verified when the email matches (case-insensitively)", async () => {
    mockFind.mockResolvedValue(order("Ada@Example.com"));

    const result = await submitReview(
      reviewInput({ email: "ada@example.com" }),
    );

    expect(result).toEqual({ success: true });
    expect(mockWrite).toHaveBeenCalledOnce();
    expect(mockWrite.mock.calls[0][0].verified).toBe(true);
  });

  it("accepts a legacy order (no stored email) but flags it unverified", async () => {
    mockFind.mockResolvedValue(order(""));

    await submitReview(reviewInput());

    expect(mockWrite).toHaveBeenCalledOnce();
    expect(mockWrite.mock.calls[0][0].verified).toBe(false);
  });
});

describe("submitReview — emails", () => {
  it("acknowledges the customer (from the orders sender) after filing", async () => {
    process.env.RESEND_FROM_EMAIL = "A.A Atelier <orders@a3iceanddance.com>";
    mockFind.mockResolvedValue(order());

    await submitReview(reviewInput({ email: "ada@example.com" }));

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][0].to).toBe("ada@example.com");
    expect(mockSend.mock.calls[0][0].from).toBe(
      "A.A Atelier <orders@a3iceanddance.com>",
    );
  });

  it("also notifies the atelier inbox (reply-to the customer) when configured", async () => {
    process.env.ATELIER_INBOX_EMAIL = "orders@a3iceanddance.com";
    mockFind.mockResolvedValue(order());

    await submitReview(reviewInput({ email: "ada@example.com" }));

    expect(mockSend).toHaveBeenCalledTimes(2);
    const notification = mockSend.mock.calls
      .map((c) => c[0])
      .find((m) => m.to === "orders@a3iceanddance.com");
    expect(notification?.replyTo).toBe("ada@example.com");
  });

  it("sends no atelier notification when no inbox is configured", async () => {
    mockFind.mockResolvedValue(order());
    await submitReview(reviewInput());
    expect(mockSend).toHaveBeenCalledOnce();
  });
});

describe("listReviews", () => {
  it("returns the published reviews under a `reviews` key", async () => {
    const reviews = [
      { id: "r1", name: "Ada", rating: 5, body: "Lovely.", date: "2026-01-15" },
    ];
    mockList.mockResolvedValue(reviews);
    expect(await listReviews()).toEqual({ reviews });
  });
});
