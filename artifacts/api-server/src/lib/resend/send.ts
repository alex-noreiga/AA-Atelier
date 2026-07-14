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

import { logger } from "../logger.js";
import {
  getResendClient,
  type EmailMessage,
  type ResendClient,
} from "./client.js";

export async function sendEmail(
  message: EmailMessage,
  client: ResendClient = getResendClient(),
): Promise<void> {
  if (!client.configured) {
    throw new Error(
      "Resend is not configured (set RESEND_API_KEY and RESEND_FROM_EMAIL)",
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
    logger.warn(
      { err, to: message.to, subject: message.subject },
      "Failed to send customer email; continuing without it",
    );
  }
}
