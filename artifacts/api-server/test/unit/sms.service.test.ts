import { describe, it, expect, vi, beforeEach } from "vitest";

// The consent seam: who may be texted, and what happens when the carrier tells
// us that permission has been withdrawn. The CRM and the transport are mocked so
// the test drives this service's own decisions.
vi.mock("../../src/lib/notion/clients.repository.js", () => ({
  findClientSmsContactByEmail: vi.fn(),
  setClientSmsConsent: vi.fn(),
  upsertClientByEmail: vi.fn(),
}));
vi.mock("../../src/lib/twilio/client.js", () => ({
  smsConfigured: vi.fn(() => true),
}));
vi.mock("../../src/lib/twilio/send.js", () => ({
  sendSmsBestEffort: vi.fn(async () => "sent"),
}));

import {
  recordSmsConsent,
  textCustomer,
} from "../../src/services/sms.service.js";
import {
  findClientSmsContactByEmail,
  setClientSmsConsent,
  upsertClientByEmail,
} from "../../src/lib/notion/clients.repository.js";
import { smsConfigured } from "../../src/lib/twilio/client.js";
import { sendSmsBestEffort } from "../../src/lib/twilio/send.js";

const build = (to: string) => ({ to, body: "A.A Atelier: hello." });

const CONSENTED = {
  pageId: "client-1",
  phone: "(512) 555-0123",
  consented: true,
};

beforeEach(() => {
  vi.mocked(smsConfigured).mockReturnValue(true);
  vi.mocked(sendSmsBestEffort).mockResolvedValue("sent");
  vi.mocked(findClientSmsContactByEmail).mockResolvedValue(CONSENTED);
});

describe("textCustomer", () => {
  it("texts a consenting customer on their normalized number", async () => {
    expect(await textCustomer("Ada@Example.com", build)).toBe("sent");
    expect(sendSmsBestEffort).toHaveBeenCalledWith({
      to: "+15125550123",
      body: "A.A Atelier: hello.",
    });
  });

  it("asks nothing of Notion when Twilio isn't configured", async () => {
    vi.mocked(smsConfigured).mockReturnValue(false);
    expect(await textCustomer("ada@example.com", build)).toBe("not-configured");
    // The cheapest gate first: an install without SMS pays no per-recipient
    // Notion read on every nightly pass.
    expect(findClientSmsContactByEmail).not.toHaveBeenCalled();
    expect(sendSmsBestEffort).not.toHaveBeenCalled();
  });

  it("sends nothing without consent on file", async () => {
    vi.mocked(findClientSmsContactByEmail).mockResolvedValue({
      ...CONSENTED,
      consented: false,
    });
    expect(await textCustomer("ada@example.com", build)).toBe("no-consent");
    expect(sendSmsBestEffort).not.toHaveBeenCalled();
  });

  it("sends nothing when there is no CRM row at all", async () => {
    vi.mocked(findClientSmsContactByEmail).mockResolvedValue(null);
    expect(await textCustomer("ada@example.com", build)).toBe("no-consent");
    expect(sendSmsBestEffort).not.toHaveBeenCalled();
  });

  it("sends nothing when the stored number can't be read, rather than guessing", async () => {
    vi.mocked(findClientSmsContactByEmail).mockResolvedValue({
      ...CONSENTED,
      phone: "call the studio",
    });
    expect(await textCustomer("ada@example.com", build)).toBe("no-number");
    expect(sendSmsBestEffort).not.toHaveBeenCalled();
  });

  it("fails closed when the consent read itself throws", async () => {
    vi.mocked(findClientSmsContactByEmail).mockRejectedValue(
      new Error("notion down"),
    );
    expect(await textCustomer("ada@example.com", build)).toBe("failed");
    expect(sendSmsBestEffort).not.toHaveBeenCalled();
  });

  it("clears the consent Twilio says has been revoked", async () => {
    vi.mocked(sendSmsBestEffort).mockResolvedValue("unsubscribed");
    expect(await textCustomer("ada@example.com", build)).toBe("unsubscribed");
    // The carrier's record of an opt-out outranks ours — stop asking.
    expect(setClientSmsConsent).toHaveBeenCalledWith("client-1", {
      consented: false,
    });
  });

  it("still reports the opt-out when clearing the consent fails", async () => {
    vi.mocked(sendSmsBestEffort).mockResolvedValue("unsubscribed");
    vi.mocked(setClientSmsConsent).mockRejectedValueOnce(
      new Error("notion down"),
    );
    expect(await textCustomer("ada@example.com", build)).toBe("unsubscribed");
  });

  it("leaves consent alone on an ordinary send failure", async () => {
    vi.mocked(sendSmsBestEffort).mockResolvedValue("failed");
    expect(await textCustomer("ada@example.com", build)).toBe("failed");
    expect(setClientSmsConsent).not.toHaveBeenCalled();
  });
});

describe("recordSmsConsent", () => {
  it("writes the tick and the number onto the customer's CRM row", async () => {
    vi.mocked(upsertClientByEmail).mockResolvedValue("client-1");
    await recordSmsConsent({
      email: "ada@example.com",
      phone: "512-555-0123",
      fullName: "Ada Lovelace",
    });
    // The number matters as much as the tick: a CRM row created by an earlier
    // contact-form inquiry carries no phone, and the upsert only writes one on
    // create — so without this the box could be ticked and still untextable.
    expect(setClientSmsConsent).toHaveBeenCalledWith("client-1", {
      consented: true,
      phone: "512-555-0123",
    });
  });

  it("does nothing when there is no CRM to record it on", async () => {
    vi.mocked(upsertClientByEmail).mockResolvedValue(null);
    await recordSmsConsent({ email: "ada@example.com", phone: "512-555-0123" });
    expect(setClientSmsConsent).not.toHaveBeenCalled();
  });

  it("swallows a Notion failure so the order it rides on is unaffected", async () => {
    vi.mocked(upsertClientByEmail).mockRejectedValue(new Error("notion down"));
    await expect(
      recordSmsConsent({ email: "ada@example.com", phone: "512-555-0123" }),
    ).resolves.toBeUndefined();
  });
});
