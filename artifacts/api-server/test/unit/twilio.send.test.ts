// The SMS transport, driven through a fake Twilio client — the same shape as
// the Resend send tests. The case worth the file is the third outcome: Twilio
// refusing because the customer replied STOP is an opt-out arriving, not a
// failure, and it must be reported distinctly so the caller can clear the
// consent it contradicts.

import { describe, expect, it, vi } from "vitest";
import type { SmsMessage, TwilioClient } from "../../src/lib/twilio/client.js";
import {
  sendSms,
  sendSmsBestEffort,
  SmsNotConfiguredError,
  SmsUnsubscribedError,
} from "../../src/lib/twilio/send.js";

const MESSAGE: SmsMessage = { to: "+15125550123", body: "A.A Atelier: hello." };

function fakeClient(
  overrides: Partial<TwilioClient> & { response?: Response } = {},
): TwilioClient {
  const { response, ...rest } = overrides;
  return {
    configured: true,
    hasCredentials: true,
    hasSender: true,
    send: vi.fn(async () => response ?? new Response("", { status: 201 })),
    ...rest,
  };
}

/** Twilio reports the specific reason as a JSON `code`. */
function twilioError(code: number, status = 400): Response {
  return new Response(JSON.stringify({ code, message: "nope" }), { status });
}

describe("sendSms", () => {
  it("sends through the client when configured", async () => {
    const client = fakeClient();
    await sendSms(MESSAGE, client);
    expect(client.send).toHaveBeenCalledWith(MESSAGE);
  });

  it("names the missing piece when credentials are absent", async () => {
    const client = fakeClient({ configured: false, hasCredentials: false });
    await expect(sendSms(MESSAGE, client)).rejects.toThrow(
      SmsNotConfiguredError,
    );
    await expect(sendSms(MESSAGE, client)).rejects.toThrow(
      /TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN/,
    );
  });

  it("names the missing piece when there is no sender", async () => {
    const client = fakeClient({ configured: false, hasSender: false });
    await expect(sendSms(MESSAGE, client)).rejects.toThrow(
      /TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER/,
    );
  });

  it("distinguishes an opt-out from a failure", async () => {
    const client = fakeClient({ response: twilioError(21610) });
    await expect(sendSms(MESSAGE, client)).rejects.toThrow(
      SmsUnsubscribedError,
    );
  });

  it("treats any other Twilio error as a plain failure", async () => {
    const client = fakeClient({ response: twilioError(21211) });
    const failure = sendSms(MESSAGE, client);
    await expect(failure).rejects.toThrow(/status 400/);
    await expect(failure).rejects.not.toThrow(SmsUnsubscribedError);
  });

  it("treats a body it can't parse as a plain failure, not an opt-out", async () => {
    const client = fakeClient({
      response: new Response("<html>gateway timeout</html>", { status: 504 }),
    });
    await expect(sendSms(MESSAGE, client)).rejects.toThrow(/status 504/);
  });
});

describe("sendSmsBestEffort", () => {
  it("reports a send", async () => {
    expect(await sendSmsBestEffort(MESSAGE, fakeClient())).toBe("sent");
  });

  it("reports an opt-out without throwing", async () => {
    const client = fakeClient({ response: twilioError(21610) });
    expect(await sendSmsBestEffort(MESSAGE, client)).toBe("unsubscribed");
  });

  it("swallows a failure so a nightly pass is never stranded", async () => {
    const client = fakeClient({ response: twilioError(21211, 500) });
    expect(await sendSmsBestEffort(MESSAGE, client)).toBe("failed");
  });

  it("swallows a thrown transport error too", async () => {
    const client = fakeClient({
      send: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    expect(await sendSmsBestEffort(MESSAGE, client)).toBe("failed");
  });

  it("reports an unconfigured sender apart from a failure", async () => {
    const client = fakeClient({ configured: false, hasSender: false });
    expect(await sendSmsBestEffort(MESSAGE, client)).toBe("unconfigured");
  });
});
