// Email transport over the Resend client. Two entry points:
//
//   - sendEmail          — strict: throws on a missing config or a non-ok
//                          response (unit-tested against a fake client).
//   - sendEmailBestEffort — what the services call: wraps sendEmail, logs any
//                          failure, and NEVER throws.
//
// Customer email is a non-critical side effect layered on top of the Notion
// write, which stays the source of truth. A Resend outage must not turn a
// successful order/contact/notify submission into a 500 — so the services only
// ever go through the best-effort path.
//
// A failed send is still swallowed, but it is logged at `error` (not `warn`) so
// a misconfigured mailer is loud in the logs rather than a silent mystery: the
// two ways a customer email can go missing (mailer not configured vs. Resend
// rejected the send) get distinct, actionable messages.

import { logger } from "../logger.js";
import {
  getResendClient,
  type EmailMessage,
  type ResendClient,
} from "./client.js";

/**
 * Thrown by `sendEmail` when the mailer can't dispatch because credentials or a
 * sender address are missing — a persistent config problem, not a transient
 * send failure. `sendEmailBestEffort` uses the type to log an actionable message
 * naming the missing piece.
 */
export class MailerNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailerNotConfiguredError";
  }
}

export async function sendEmail(
  message: EmailMessage,
  client: ResendClient = getResendClient(),
): Promise<void> {
  // Gate on the *resolved* sender (a per-message `from` overrides the base), so a
  // per-category sender still works when only its override — not the base
  // `RESEND_FROM_EMAIL` — is set. Name the missing piece for the log.
  const resolvedFrom = message.from || client.baseFrom;
  if (!client.hasApiKey || !resolvedFrom) {
    const missing = [
      client.hasApiKey ? null : "RESEND_API_KEY",
      resolvedFrom ? null : "a sender address (RESEND_FROM_EMAIL)",
    ].filter(Boolean);
    throw new MailerNotConfiguredError(
      `Resend is not configured — missing ${missing.join(" and ")}`,
    );
  }

  const response = await client.send(message);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Resend email send failed with status ${response.status}: ${errorText}`,
    );
  }
}

/**
 * Best-effort send: dispatches the email and swallows every failure (logged),
 * so a mail problem never propagates into the customer's request. Returns once
 * the attempt settles.
 */
export async function sendEmailBestEffort(
  message: EmailMessage,
  client: ResendClient = getResendClient(),
): Promise<void> {
  try {
    await sendEmail(message, client);
  } catch (err) {
    if (err instanceof MailerNotConfiguredError) {
      logger.error(
        { err, to: message.to, subject: message.subject },
        "Email NOT sent: mailer is not configured. Set RESEND_API_KEY and " +
          "RESEND_FROM_EMAIL in the environment and verify the sending domain " +
          "in Resend, then redeploy. Continuing without the email.",
      );
      return;
    }
    logger.error(
      { err, to: message.to, subject: message.subject },
      "Email send failed (Resend rejected the request); continuing without it",
    );
    // Escalate a real send failure to a production alert, so a silently-dropped
    // customer email surfaces. Env-guarded (no mailer ⇒ nothing to alert with,
    // and it keeps this inert in dev/test) and lazily imported to avoid a static
    // import cycle — resend must not statically depend on services. reportEmailFailure
    // is itself best-effort and never throws.
    if (process.env.RESEND_API_KEY) {
      try {
        const { reportEmailFailure } =
          await import("../../services/alert.service.js");
        await reportEmailFailure(message, err);
      } catch {
        // Alerting must never turn a swallowed email failure into a throw.
      }
    }
  }
}
