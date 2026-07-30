import { describe, it, expect, vi, afterEach } from "vitest";
import { returnRequestInput } from "@workspace/test-fixtures";

// Mock the shop-order lookup (identity source), the inbox writer, the CRM
// upsert, and best-effort send. The gates run for real between them.
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  findShopOrderVerification: vi.fn(),
}));
vi.mock("../../src/lib/notion/return-request.repository.js", () => ({
  createReturnRequest: vi.fn(),
}));
vi.mock("../../src/lib/notion/clients.repository.js", () => ({
  upsertClientByEmail: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import { submitReturnRequest } from "../../src/services/return-request.service.js";
import { findShopOrderVerification } from "../../src/lib/notion/shop-orders.repository.js";
import { createReturnRequest } from "../../src/lib/notion/return-request.repository.js";
import { upsertClientByEmail } from "../../src/lib/notion/clients.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import { NotFoundError, ForbiddenError } from "../../src/lib/errors.js";

const mockFind = vi.mocked(findShopOrderVerification);
const mockWrite = vi.mocked(createReturnRequest);
const mockUpsertClient = vi.mocked(upsertClientByEmail);
const mockSend = vi.mocked(sendEmailBestEffort);

afterEach(() => {
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.ATELIER_INBOX_EMAIL;
});

describe("submitReturnRequest — identity gate", () => {
  it("throws NotFoundError when the order does not exist", async () => {
    mockFind.mockResolvedValue(null);
    await expect(
      submitReturnRequest("SHP-NOPE", returnRequestInput()),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError and never writes when the email doesn't match", async () => {
    mockFind.mockResolvedValue({ email: "someone-else@example.com" });
    await expect(
      submitReturnRequest(
        "SHP-ABC-1234",
        returnRequestInput({ email: "grace@example.com" }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("files the request marked verified when the email matches (case-insensitively, trimmed order)", async () => {
    mockFind.mockResolvedValue({ email: "Grace@Example.com" });

    const result = await submitReturnRequest(
      "  SHP-ABC-1234  ",
      returnRequestInput({ email: "grace@example.com" }),
    );

    expect(result).toEqual({ received: true });
    expect(mockWrite).toHaveBeenCalledOnce();
    const row = mockWrite.mock.calls[0][0];
    expect(row.orderNumber).toBe("SHP-ABC-1234");
    expect(row.emailVerified).toBe(true);
  });

  it("accepts a legacy order (no stored email) but flags it unverified", async () => {
    mockFind.mockResolvedValue({ email: "" });

    await submitReturnRequest("SHP-ABC-1234", returnRequestInput());

    expect(mockWrite).toHaveBeenCalledOnce();
    expect(mockWrite.mock.calls[0][0].emailVerified).toBe(false);
  });

  it("links the request to the customer's Client CRM record (dedupe by email)", async () => {
    mockFind.mockResolvedValue({ email: "grace@example.com" });
    mockUpsertClient.mockResolvedValue("client-5");

    await submitReturnRequest(
      "SHP-ABC-1234",
      returnRequestInput({ email: "grace@example.com" }),
    );

    // The order customer is already Active; upsert dedupes by email (no status
    // override, so a new row would default to Active).
    expect(mockUpsertClient).toHaveBeenCalledWith({
      fullName: "",
      email: "grace@example.com",
    });
    // The resolved client page id is threaded into the inbox-row write.
    expect(mockWrite.mock.calls[0][2]).toBe("client-5");
  });
});

describe("submitReturnRequest — emails", () => {
  it("confirms to the customer (from the orders sender) after filing", async () => {
    process.env.RESEND_FROM_EMAIL = "A.A Atelier <orders@a3iceanddance.com>";
    mockFind.mockResolvedValue({ email: "grace@example.com" });

    await submitReturnRequest(
      "SHP-ABC-1234",
      returnRequestInput({ email: "grace@example.com" }),
    );

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][0].to).toBe("grace@example.com");
    expect(mockSend.mock.calls[0][0].from).toBe(
      "A.A Atelier <orders@a3iceanddance.com>",
    );
  });

  it("also notifies the atelier inbox (reply-to the customer) when configured", async () => {
    process.env.ATELIER_INBOX_EMAIL = "orders@a3iceanddance.com";
    mockFind.mockResolvedValue({ email: "grace@example.com" });

    await submitReturnRequest(
      "SHP-ABC-1234",
      returnRequestInput({ email: "grace@example.com" }),
    );

    expect(mockSend).toHaveBeenCalledTimes(2);
    const notification = mockSend.mock.calls
      .map((c) => c[0])
      .find((m) => m.to === "orders@a3iceanddance.com");
    expect(notification?.replyTo).toBe("grace@example.com");
  });

  it("sends no atelier notification when no inbox is configured", async () => {
    mockFind.mockResolvedValue({ email: "grace@example.com" });
    await submitReturnRequest("SHP-ABC-1234", returnRequestInput());
    expect(mockSend).toHaveBeenCalledOnce();
  });
});
