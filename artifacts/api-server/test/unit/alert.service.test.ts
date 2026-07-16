import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the transport so nothing touches the network; the suite drives the alert
// logic (log + best-effort send, dedupe, loop-safety, config gate) directly.
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

import { sendEmail } from "../../src/lib/resend/send.js";
import { logger } from "../../src/lib/logger.js";
import {
  reportError,
  reportEmailFailure,
} from "../../src/services/alert.service.js";

const mockSendEmail = vi.mocked(sendEmail);

// The dedupe map is module-level state that persists across tests in this file,
// so each test uses a UNIQUE message/error to avoid being suppressed by another
// test's alert (except the dedupe test, which repeats on purpose).
beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("RESEND_FROM_EMAIL", "A.A Atelier <orders@a3iceanddance.com>");
  vi.stubEnv("ALERT_INBOX_EMAIL", "");
  mockSendEmail.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("reportError", () => {
  it("logs at error and emails an alert to the default inbox", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const err = new Error("Notion 500");

    await reportError({ err, path: "/api/orders" }, "case: logs and alerts");

    // Preserves the prior logging behavior.
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][1]).toBe("case: logs and alerts");

    // And escalates to an alert email.
    expect(mockSendEmail).toHaveBeenCalledOnce();
    const sent = mockSendEmail.mock.calls[0][0];
    expect(sent.to).toBe("alexandra@a3iceanddance.com");
    expect(sent.from).toBe("A.A Atelier <orders@a3iceanddance.com>");
    expect(sent.subject).toContain("case: logs and alerts");
    expect(sent.text).toContain("Notion 500");
  });

  it("honors the ALERT_INBOX_EMAIL override", async () => {
    vi.stubEnv("ALERT_INBOX_EMAIL", "dev-alerts@example.com");
    vi.spyOn(logger, "error").mockImplementation(() => logger);

    await reportError({ err: new Error("x") }, "case: inbox override");

    expect(mockSendEmail.mock.calls[0][0].to).toBe("dev-alerts@example.com");
  });

  it("de-dupes a repeated alert signature within the window", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => logger);
    const err = new Error("same failure");

    await reportError({ err }, "case: dedupe");
    await reportError({ err }, "case: dedupe");

    // Both were logged, but only one email went out.
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it("is loop-safe: a failing alert send only warns, without recursing", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => logger);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    mockSendEmail.mockRejectedValueOnce(new Error("resend down"));

    await expect(
      reportError({ err: new Error("y") }, "case: loop-safe"),
    ).resolves.toBeUndefined();

    // Exactly one send attempt (no re-alert on the failed alert), and a warn.
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("still logs but does not send when the mailer is unconfigured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const error = vi.spyOn(logger, "error").mockImplementation(() => logger);

    await reportError({ err: new Error("z") }, "case: unconfigured");

    expect(error).toHaveBeenCalledOnce();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe("reportEmailFailure", () => {
  it("alerts with the failed email's subject and does not re-log at error", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => logger);

    await reportEmailFailure(
      {
        to: "ada@example.com",
        subject: "We've received your order (000002)",
        html: "<p>hi</p>",
        text: "hi",
      },
      new Error("Resend rejected"),
    );

    // The transport already logged the failure; this only escalates to an alert.
    expect(error).not.toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail.mock.calls[0][0].subject).toContain(
      "Customer email failed to send: We've received your order (000002)",
    );
  });
});
