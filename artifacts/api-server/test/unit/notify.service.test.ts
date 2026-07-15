import { describe, it, expect, vi, afterEach } from "vitest";
import { notifyInput } from "@workspace/test-fixtures";

vi.mock("../../src/lib/notion/notify.repository.js", () => ({
  createBackInStockRequest: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import { submitBackInStockRequest } from "../../src/services/notify.service.js";
import { createBackInStockRequest } from "../../src/lib/notion/notify.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";

const mockCreate = vi.mocked(createBackInStockRequest);
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
