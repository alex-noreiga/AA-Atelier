// In-process production error alerting.
//
// When the app hits an error-level condition it can't otherwise surface — an
// unhandled 500, or a best-effort side effect that fails and still returns
// success — `reportError` logs it (exactly as the code did before) AND emails an
// alert, so the atelier finds out without watching the Vercel logs.
//
// Why in-process rather than a Vercel Log Drain: Log Drains require a
// Pro/Enterprise plan and this project is on Hobby. Alerting inline also flushes
// reliably on serverless because the send is awaited within the request
// lifecycle, before the function is frozen (a fire-and-forget drain/stream can be
// dropped). The trade-off is the per-instance de-dupe below (serverless is
// stateless, so it can't throttle across instances).
//
// Loop guard: the alert email is sent through the STRICT `sendEmail` wrapped in a
// local catch that logs at `warn` (below the alert threshold) and never calls
// back into `reportError` — so a failing alert can never trigger another alert.
// Reusing the Resend adapter keeps this vendor-free.

import { logger } from "../lib/logger.js";
import { sendEmail } from "../lib/resend/send.js";
import {
  errorAlertEmail,
  type ErrorAlertDetails,
} from "../lib/resend/emails.js";
import type { EmailMessage } from "../lib/resend/client.js";

/** Where alerts go when `ALERT_INBOX_EMAIL` is unset. */
const DEFAULT_ALERT_INBOX = "alexandra@a3iceanddance.com";
// Suppress a repeated alert signature within this window so a hot error loop in a
// warm lambda can't flood the inbox. Best-effort: de-dupes within a process
// instance, not across the separate instances serverless may spin up.
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
// Cap how long a slow Resend can delay the response the alert is riding on.
const SEND_TIMEOUT_MS = 3000;

const recentAlerts = new Map<string, number>();

function alertInbox(): string {
  return process.env.ALERT_INBOX_EMAIL || DEFAULT_ALERT_INBOX;
}

/** True (and records it) when this signature hasn't alerted within the window. */
function claimAlert(signature: string, now: number): boolean {
  const last = recentAlerts.get(signature);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return false;
  recentAlerts.set(signature, now);
  // Opportunistic cleanup so the map can't grow unbounded in a long-lived process.
  if (recentAlerts.size > 200) {
    for (const [key, at] of recentAlerts) {
      if (now - at >= DEDUPE_WINDOW_MS) recentAlerts.delete(key);
    }
  }
  return true;
}

/** Pull the alert-relevant fields out of whatever was thrown. */
function describeError(err: unknown): {
  errorType?: string;
  errorMessage?: string;
  stack?: string;
} {
  if (err instanceof Error) {
    return {
      errorType: err.name,
      errorMessage: err.message,
      ...(err.stack ? { stack: err.stack.slice(0, 2000) } : {}),
    };
  }
  if (err !== undefined && err !== null) {
    return { errorMessage: String(err) };
  }
  return {};
}

/** Reject after `ms` so a hung send can't stall the response it rides on. */
async function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`alert send timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort, loop-safe alert email for an error condition. Self-gates when
 * Resend isn't configured (so it's inert in dev/test and never blocks a
 * response), de-dupes, and swallows its own failure at `warn`. Never throws.
 */
async function sendErrorAlert(
  message: string,
  context: Record<string, unknown>,
): Promise<void> {
  const from = process.env.RESEND_FROM_EMAIL ?? "";
  // No mailer configured ⇒ can't (and needn't) alert; the log line still stands.
  if (!process.env.RESEND_API_KEY || !from) return;

  const described = describeError(context.err);
  const signature = `${message}|${described.errorType ?? ""}|${described.errorMessage ?? ""}`;
  const now = Date.now();
  if (!claimAlert(signature, now)) return;

  const details: ErrorAlertDetails = {
    message,
    ...described,
    ...(typeof context.method === "string" ? { method: context.method } : {}),
    ...(typeof context.path === "string" ? { path: context.path } : {}),
    ...(typeof context.requestId === "string"
      ? { requestId: context.requestId }
      : {}),
    ...(typeof context.statusCode === "number"
      ? { statusCode: context.statusCode }
      : {}),
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    timestamp: new Date(now).toISOString(),
  };

  try {
    await withTimeout(
      sendEmail({ ...errorAlertEmail(details, alertInbox()), from }),
      SEND_TIMEOUT_MS,
    );
  } catch (alertErr) {
    // Loop guard: a failed alert only warns — it never re-enters reportError.
    logger.warn(
      { err: alertErr, alertFor: message },
      "Failed to send error-alert email; continuing",
    );
  }
}

/**
 * Log an error (as the code did before) and email an alert. Use this in place of
 * `logger.error` at sites where a production failure would otherwise be invisible
 * — the central 500 handler and the best-effort side-effect catches.
 */
export async function reportError(
  context: Record<string, unknown>,
  message: string,
): Promise<void> {
  logger.error(context, message);
  await sendErrorAlert(message, context);
}

/**
 * Escalate a customer email that failed to send to an alert. Called from the
 * Resend transport's best-effort path, which has ALREADY logged the failure — so
 * this only alerts, it does not re-log at error.
 */
export async function reportEmailFailure(
  emailMessage: EmailMessage,
  err: unknown,
): Promise<void> {
  await sendErrorAlert(
    `Customer email failed to send: ${emailMessage.subject}`,
    {
      err,
      to: emailMessage.to,
      subject: emailMessage.subject,
    },
  );
}
