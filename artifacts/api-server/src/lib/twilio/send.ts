// SMS transport over the Twilio client. Two entry points, mirroring
// `lib/resend/send.ts`:
//
//   - sendSms           — strict: throws on missing config or a non-ok response.
//   - sendSmsBestEffort — what the services call: never throws, and reports
//                         WHICH of three things happened.
//
// The difference from the email transport is that third outcome. Twilio refuses
// a send to a number that has replied STOP (error 21610), and that refusal is
// not a fault — it is the customer's opt-out arriving through the only channel
// they have. Swallowing it as "failed" would leave the studio texting a number
// every night that Twilio will never deliver to, while the CRM went on claiming
// consent. So it is reported distinctly and the caller clears the consent it
// contradicts (`services/sms.service.ts`) — the carrier's record of an opt-out
// outranks ours, the same way Stripe outranks the Notion refund markers.
//
// A genuine failure is logged at `error` and deliberately NOT escalated to the
// production alert inbox, unlike a rejected email. Every text this app sends
// goes out ALONGSIDE an email carrying the same news, so a dropped SMS costs a
// notification its second channel, never the notification itself — which is the
// bar the alerting section sets for staying high-signal.

import { logger } from "../logger.js";
import {
  getTwilioClient,
  type SmsMessage,
  type TwilioClient,
} from "./client.js";

/** Twilio's error code for "attempt to send to unsubscribed recipient" — the
 * customer replied STOP. Twilio owns the opt-out list and honours it itself; we
 * read this only to stop asking. */
const UNSUBSCRIBED_ERROR_CODE = 21610;

/**
 * Thrown by `sendSms` when the sender can't dispatch because credentials or a
 * sending identity are missing — a persistent config problem, not a transient
 * send failure. `sendSmsBestEffort` uses the type to log an actionable message
 * naming the missing piece.
 */
export class SmsNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmsNotConfiguredError";
  }
}

/**
 * Thrown by `sendSms` when Twilio refuses because the recipient has opted out.
 * Carried as its own type so the best-effort wrapper can report it apart from a
 * failure — see the header.
 */
export class SmsUnsubscribedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmsUnsubscribedError";
  }
}

/** What one best-effort send did. `unsubscribed` is a fact about the recipient,
 * not an error: the caller acts on it by clearing their stored consent. */
export type SmsSendResult = "sent" | "unsubscribed" | "failed" | "unconfigured";

export async function sendSms(
  message: SmsMessage,
  client: TwilioClient = getTwilioClient(),
): Promise<void> {
  if (!client.configured) {
    const missing = [
      client.hasCredentials ? null : "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN",
      client.hasSender
        ? null
        : "a sending identity (TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER)",
    ].filter(Boolean);
    throw new SmsNotConfiguredError(
      `Twilio is not configured — missing ${missing.join(" and ")}`,
    );
  }

  const response = await client.send(message);
  if (response.ok) return;

  const errorText = await response.text();
  // Twilio reports the specific reason in a JSON `code`, and the one we must
  // tell apart is the opt-out. Parsed defensively — a body that isn't the JSON
  // we expect is simply a failure, which is what it would have been anyway.
  let code: number | undefined;
  try {
    code = (JSON.parse(errorText) as { code?: number }).code;
  } catch {
    code = undefined;
  }
  if (code === UNSUBSCRIBED_ERROR_CODE) {
    throw new SmsUnsubscribedError(
      "Twilio refused the message: the recipient has replied STOP",
    );
  }
  throw new Error(
    `Twilio SMS send failed with status ${response.status}: ${errorText}`,
  );
}

/**
 * Best-effort send: dispatches the text and swallows every failure (logged), so
 * an SMS problem never propagates into a customer's request or a nightly cron.
 * Returns what happened, so a caller can act on an opt-out.
 */
export async function sendSmsBestEffort(
  message: SmsMessage,
  client: TwilioClient = getTwilioClient(),
): Promise<SmsSendResult> {
  try {
    await sendSms(message, client);
    return "sent";
  } catch (err) {
    if (err instanceof SmsNotConfiguredError) {
      // `warn`, not `error`: unlike the mailer, SMS is an opt-in extra the
      // atelier may simply never have turned on, and every caller already
      // gates on `smsConfigured()`. Reaching here means a half-set config.
      logger.warn(
        { err, to: message.to },
        "Text NOT sent: Twilio is not configured. Set TWILIO_ACCOUNT_SID, " +
          "TWILIO_AUTH_TOKEN and a sending identity, then redeploy. " +
          "Continuing without the text.",
      );
      return "unconfigured";
    }
    if (err instanceof SmsUnsubscribedError) {
      logger.info(
        { to: message.to },
        "Recipient has opted out of texts (replied STOP); clearing their SMS consent",
      );
      return "unsubscribed";
    }
    logger.error(
      { err, to: message.to },
      "Text send failed (Twilio rejected the request); the matching email still went out",
    );
    return "failed";
  }
}
