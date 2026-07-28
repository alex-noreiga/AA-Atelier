import { describe, it, expect, vi, afterEach } from "vitest";
import { newsletterInput } from "@workspace/test-fixtures";

vi.mock("../../src/lib/notion/newsletter.repository.js", () => ({
  createNewsletterSubscription: vi.fn(),
}));
vi.mock("../../src/lib/notion/clients.repository.js", () => ({
  upsertClientByEmail: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import { subscribeToNewsletter } from "../../src/services/newsletter.service.js";
import { createNewsletterSubscription } from "../../src/lib/notion/newsletter.repository.js";
import { upsertClientByEmail } from "../../src/lib/notion/clients.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";

const mockCreate = vi.mocked(createNewsletterSubscription);
const mockUpsertClient = vi.mocked(upsertClientByEmail);
const mockSend = vi.mocked(sendEmailBestEffort);

afterEach(() => {
  delete process.env.ATELIER_INBOX_EMAIL;
  delete process.env.ATELIER_CONTACT_INBOX_EMAIL;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.RESEND_CONTACT_FROM_EMAIL;
});

describe("subscribeToNewsletter", () => {
  it("files the opt-in and welcomes the customer", async () => {
    mockCreate.mockResolvedValue(undefined);

    const result = await subscribeToNewsletter(
      newsletterInput({ email: "grace@example.com" }),
    );

    expect(result).toEqual({ success: true });
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][0].to).toBe("grace@example.com");
  });

  it("upserts a Client CRM record (Lead, named by email) and links the opt-in", async () => {
    mockUpsertClient.mockResolvedValue("client-77");
    const input = newsletterInput({ email: "grace@example.com" });

    await subscribeToNewsletter(input);

    expect(mockUpsertClient).toHaveBeenCalledWith({
      fullName: "",
      email: "grace@example.com",
      status: "Lead",
    });
    expect(mockCreate).toHaveBeenCalledWith(input, undefined, "client-77");
  });

  it("still files the opt-in (unlinked) when the CRM upsert fails", async () => {
    mockUpsertClient.mockRejectedValue(new Error("CRM down"));
    const input = newsletterInput({ email: "grace@example.com" });

    const result = await subscribeToNewsletter(input);

    expect(result).toEqual({ success: true });
    expect(mockCreate).toHaveBeenCalledWith(input, undefined, undefined);
  });

  it("never emails the atelier inbox — a mailing-list opt-in needs no triage", async () => {
    process.env.ATELIER_INBOX_EMAIL = "orders@a3iceanddance.com";
    process.env.ATELIER_CONTACT_INBOX_EMAIL = "hello@a3iceanddance.com";
    mockCreate.mockResolvedValue(undefined);

    await subscribeToNewsletter(newsletterInput());

    // Only the customer welcome — no internal notification, unlike the
    // transactional flows.
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("welcomes from the contact sender (hello@), keeping it off orders@", async () => {
    process.env.RESEND_FROM_EMAIL = "A.A Atelier <orders@a3iceanddance.com>";
    process.env.RESEND_CONTACT_FROM_EMAIL =
      "A.A Atelier <hello@a3iceanddance.com>";
    mockCreate.mockResolvedValue(undefined);

    await subscribeToNewsletter(newsletterInput());

    expect(mockSend.mock.calls[0][0].from).toBe(
      "A.A Atelier <hello@a3iceanddance.com>",
    );
  });
});
