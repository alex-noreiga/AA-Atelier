import { describe, it, expect, vi } from "vitest";
import { sendEmail, sendEmailBestEffort } from "../../src/lib/resend/send.js";
import { logger } from "../../src/lib/logger.js";
import { makeFakeResendClient, errorResponse } from "../support/fake-resend.js";

const message = {
  to: "ada@example.com",
  subject: "We've received your order (000002)",
  html: "<p>hi</p>",
  text: "hi",
};

describe("sendEmail", () => {
  it("sends the message through the client on the happy path", async () => {
    const client = makeFakeResendClient();

    await sendEmail(message, client);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual(message);
  });

  it("throws when the client is not configured, without sending", async () => {
    const client = makeFakeResendClient(undefined, false);

    await expect(sendEmail(message, client)).rejects.toThrow(/not configured/i);
    expect(client.calls).toHaveLength(0);
  });

  it("names the missing API key in the not-configured error", async () => {
    // hasApiKey false, but a base from is present — the message should call out
    // the key so the log points at the right env var.
    const client = makeFakeResendClient(undefined, false, {
      hasApiKey: false,
      baseFrom: "A.A Atelier <orders@a3iceanddance.com>",
    });

    await expect(sendEmail(message, client)).rejects.toThrow(/RESEND_API_KEY/);
  });

  it("sends when a per-message from covers an unset base from (has API key)", async () => {
    // The trap fix: an API key is present but the base RESEND_FROM_EMAIL is
    // unset; a per-message `from` (e.g. a per-category override) must still send.
    const client = makeFakeResendClient(undefined, false, {
      hasApiKey: true,
      baseFrom: "",
    });

    await sendEmail(
      { ...message, from: "A.A Atelier <hello@a3iceanddance.com>" },
      client,
    );

    expect(client.calls).toHaveLength(1);
  });

  it("throws when the Resend response is not ok", async () => {
    const client = makeFakeResendClient(() => errorResponse(422, "bad from"));

    await expect(sendEmail(message, client)).rejects.toThrow(/422/);
  });
});

describe("sendEmailBestEffort", () => {
  it("swallows a non-ok response and logs an error", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const client = makeFakeResendClient(() => errorResponse(500));

    await expect(sendEmailBestEffort(message, client)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][1]).toMatch(/send failed/i);
  });

  it("swallows a thrown transport error and logs an error", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const client = makeFakeResendClient(() => {
      throw new Error("network down");
    });

    await expect(sendEmailBestEffort(message, client)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
  });

  it("logs an actionable, distinct message when the mailer is not configured", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const client = makeFakeResendClient(undefined, false);

    await expect(sendEmailBestEffort(message, client)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
    // Distinguished from a send failure: names the fix, not just "failed".
    expect(error.mock.calls[0][1]).toMatch(/not configured/i);
    expect(error.mock.calls[0][1]).toMatch(/RESEND_API_KEY/);
    expect(client.calls).toHaveLength(0);
  });

  it("does not log when the send succeeds", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const client = makeFakeResendClient();

    await sendEmailBestEffort(message, client);

    expect(error).not.toHaveBeenCalled();
    expect(client.calls).toHaveLength(1);
  });
});
