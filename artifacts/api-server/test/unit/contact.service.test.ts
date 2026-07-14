import { describe, it, expect, vi, afterEach } from "vitest";
import { contactInput } from "@workspace/test-fixtures";

vi.mock("../../src/lib/notion/contact.repository.js", () => ({
  createContactMessage: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import { submitContactMessage } from "../../src/services/contact.service.js";
import { createContactMessage } from "../../src/lib/notion/contact.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";

const mockCreate = vi.mocked(createContactMessage);
const mockSend = vi.mocked(sendEmailBestEffort);

afterEach(() => {
  delete process.env.ATELIER_INBOX_EMAIL;
  delete process.env.ATELIER_CONTACT_INBOX_EMAIL;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.RESEND_CONTACT_FROM_EMAIL;
});

describe("submitContactMessage", () => {
  it("saves the message and acknowledges the customer", async () => {
    mockCreate.mockResolvedValue(undefined);

    const result = await submitContactMessage(
      contactInput({ email: "grace@example.com" }),
    );

    expect(result).toEqual({ success: true });
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][0].to).toBe("grace@example.com");
  });

  it("also notifies the atelier inbox (reply-to the customer) when configured", async () => {
    process.env.ATELIER_INBOX_EMAIL = "orders@a3iceanddance.com";
    mockCreate.mockResolvedValue(undefined);

    await submitContactMessage(contactInput({ email: "grace@example.com" }));

    expect(mockSend).toHaveBeenCalledTimes(2);
    const notification = mockSend.mock.calls
      .map((c) => c[0])
      .find((m) => m.to === "orders@a3iceanddance.com");
    expect(notification).toBeDefined();
    expect(notification?.replyTo).toBe("grace@example.com");
  });

  it("sends from the contact sender (hello@) and notifies the contact inbox when configured", async () => {
    process.env.RESEND_FROM_EMAIL = "A.A Atelier <orders@a3iceanddance.com>";
    process.env.RESEND_CONTACT_FROM_EMAIL =
      "A.A Atelier <hello@a3iceanddance.com>";
    process.env.ATELIER_CONTACT_INBOX_EMAIL = "hello@a3iceanddance.com";
    mockCreate.mockResolvedValue(undefined);

    await submitContactMessage(contactInput({ email: "grace@example.com" }));

    expect(mockSend).toHaveBeenCalledTimes(2);
    for (const [message] of mockSend.mock.calls) {
      expect(message.from).toBe("A.A Atelier <hello@a3iceanddance.com>");
    }
    const notification = mockSend.mock.calls
      .map((c) => c[0])
      .find((m) => m.to === "hello@a3iceanddance.com");
    expect(notification).toBeDefined();
    expect(notification?.replyTo).toBe("grace@example.com");
  });

  it("falls back to the base sender/inbox when the contact overrides are unset", async () => {
    process.env.RESEND_FROM_EMAIL = "A.A Atelier <orders@a3iceanddance.com>";
    process.env.ATELIER_INBOX_EMAIL = "orders@a3iceanddance.com";
    mockCreate.mockResolvedValue(undefined);

    await submitContactMessage(contactInput({ email: "grace@example.com" }));

    expect(mockSend).toHaveBeenCalledTimes(2);
    for (const [message] of mockSend.mock.calls) {
      expect(message.from).toBe("A.A Atelier <orders@a3iceanddance.com>");
    }
    expect(
      mockSend.mock.calls
        .map((c) => c[0])
        .find((m) => m.to === "orders@a3iceanddance.com"),
    ).toBeDefined();
  });
});
