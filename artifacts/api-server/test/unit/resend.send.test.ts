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

  it("throws when the Resend response is not ok", async () => {
    const client = makeFakeResendClient(() => errorResponse(422, "bad from"));

    await expect(sendEmail(message, client)).rejects.toThrow(/422/);
  });
});

describe("sendEmailBestEffort", () => {
  it("swallows a non-ok response and logs a warning", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const client = makeFakeResendClient(() => errorResponse(500));

    await expect(sendEmailBestEffort(message, client)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("swallows a thrown transport error and logs a warning", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const client = makeFakeResendClient(() => {
      throw new Error("network down");
    });

    await expect(sendEmailBestEffort(message, client)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("does not log when the send succeeds", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const client = makeFakeResendClient();

    await sendEmailBestEffort(message, client);

    expect(warn).not.toHaveBeenCalled();
    expect(client.calls).toHaveLength(1);
  });
});
