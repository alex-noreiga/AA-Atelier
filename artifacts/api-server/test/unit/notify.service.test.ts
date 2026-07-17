import { describe, it, expect, vi, afterEach } from "vitest";
import { notifyInput } from "@workspace/test-fixtures";

vi.mock("../../src/lib/notion/notify.repository.js", () => ({
  createBackInStockRequest: vi.fn(),
}));
vi.mock("../../src/lib/notion/clients.repository.js", () => ({
  upsertClientByEmail: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import { submitBackInStockRequest } from "../../src/services/notify.service.js";
import { createBackInStockRequest } from "../../src/lib/notion/notify.repository.js";
import { upsertClientByEmail } from "../../src/lib/notion/clients.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";

const mockCreate = vi.mocked(createBackInStockRequest);
const mockUpsertClient = vi.mocked(upsertClientByEmail);
const mockSend = vi.mocked(sendEmailBestEffort);

afterEach(() => {
  delete process.env.ATELIER_INBOX_EMAIL;
  delete process.env.RESEND_FROM_EMAIL;
});

describe("submitBackInStockRequest", () => {
  it("files the request and confirms to the customer", async () => {
    mockCreate.mockResolvedValue(undefined);

    const result = await submitBackInStockRequest(
      notifyInput({ email: "grace@example.com" }),
    );

    expect(result).toEqual({ success: true });
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][0].to).toBe("grace@example.com");
  });

  it("upserts a Client CRM record (Lead, named by email) and links the request", async () => {
    mockUpsertClient.mockResolvedValue("client-88");
    const input = notifyInput({ email: "grace@example.com" });

    await submitBackInStockRequest(input);

    // A back-in-stock request has only an email; the CRM row is a Lead named by
    // the email (fullName left blank so the repository falls back to it).
    expect(mockUpsertClient).toHaveBeenCalledWith({
      fullName: "",
      email: "grace@example.com",
      status: "Lead",
    });
    expect(mockCreate).toHaveBeenCalledWith(input, undefined, "client-88");
  });

  it("still files the request (unlinked) when the CRM upsert fails", async () => {
    mockUpsertClient.mockRejectedValue(new Error("CRM down"));
    const input = notifyInput({ email: "grace@example.com" });

    const result = await submitBackInStockRequest(input);

    expect(result).toEqual({ success: true });
    expect(mockCreate).toHaveBeenCalledWith(input, undefined, undefined);
  });

  it("also notifies the atelier inbox (reply-to the customer) when configured", async () => {
    process.env.ATELIER_INBOX_EMAIL = "orders@a3iceanddance.com";
    mockCreate.mockResolvedValue(undefined);

    await submitBackInStockRequest(notifyInput({ email: "grace@example.com" }));

    expect(mockSend).toHaveBeenCalledTimes(2);
    const notification = mockSend.mock.calls
      .map((c) => c[0])
      .find((m) => m.to === "orders@a3iceanddance.com");
    expect(notification).toBeDefined();
    expect(notification?.replyTo).toBe("grace@example.com");
  });

  it("sends from the orders sender (back-in-stock is grouped with orders)", async () => {
    process.env.RESEND_FROM_EMAIL = "A.A Atelier <orders@a3iceanddance.com>";
    mockCreate.mockResolvedValue(undefined);

    await submitBackInStockRequest(notifyInput({ email: "grace@example.com" }));

    expect(mockSend.mock.calls[0][0].from).toBe(
      "A.A Atelier <orders@a3iceanddance.com>",
    );
  });
});
