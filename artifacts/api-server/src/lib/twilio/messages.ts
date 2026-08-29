// The text of every SMS the app sends — the counterpart of `lib/resend/emails.ts`,
// and the only place this copy lives, so the atelier can read and approve it in
// one file.
//
// Four rules shape all of it:
//
//  1. **A text says the one thing and links to the rest.** Each of these goes out
//     ALONGSIDE an email carrying the full detail, so the text is the nudge, not
//     a second copy of the letter. That is also why a missing `PUBLIC_BASE_URL`
//     degrades to "check your email" rather than to nothing — there is always a
//     fuller version of this message already in the customer's inbox.
//  2. **The studio names itself first.** A text arrives from a number nobody has
//     saved, so the first words have to say who it is or it reads as spam.
//  3. **Every message carries the opt-out.** Twilio honours STOP itself (and a
//     Messaging Service with Advanced Opt-Out appends its own language to the
//     first message), so this is belt-and-braces — but it costs ~22 characters
//     against a possible second segment, and being unmistakably opt-out-able is
//     worth more than a fraction of a cent.
//  4. **One segment where a link allows it.** See `SMS_SEGMENT_LIMIT`.

import type { SmsMessage } from "./client.js";
import { clampField } from "../../services/sms.js";
import { formatCalendarDateShort } from "../format-date.js";
import { STUDIO_CURRENCY } from "../currency.js";

/** How the studio names itself in a text. Shorter than the email's signature —
 * every character here is billed. */
const SENDER_LABEL = "A.A Atelier";

/** The opt-out line every message ends with (rule 3 above). */
const OPT_OUT = "Reply STOP to opt out.";

/** Longest a customer's first name may be before it is trimmed. Generous for a
 * real name, bounded so one pasted into the wrong field can't cost a segment. */
const NAME_LIMIT = 20;

/** Compose the final body: the studio's name, the message, then the opt-out. */
function compose(sentences: string[]): string {
  return `${SENDER_LABEL}: ${sentences.filter(Boolean).join(" ")} ${OPT_OUT}`;
}

/** "Pay at <url>." or, with no public base URL configured, a pointer to the
 * email that carries the same news. Rule 1. */
function linkSentence(action: string, url?: string): string {
  return url
    ? `${action}: ${url}`
    : "Details are in the email we've just sent.";
}

/** The details a payment-due text needs. Mirrors `paymentReminderEmail`'s own
 * details struct — both are handed already-formatted values by the reminder
 * pass, so neither builder re-derives money or dates. */
export interface PaymentDueSmsDetails {
  /** E.164 recipient. */
  to: string;
  orderNumber: string;
  /** What this payment is called for this service — "First deposit", "Balance"
   * — already relabelled by `services/payment-labels.ts`. Lowercased here for
   * mid-sentence use, exactly as `paymentReminderEmail` does with the same
   * value. */
  stageLabel: string;
  /** The due date as an ISO `yyyy-mm-dd`, formatted here — the same raw value
   * the email builder is handed, so neither can quote a date the other doesn't. */
  dueDate: string;
  /** True when the date has passed, so the text says "was due". */
  overdue: boolean;
  /** The amount in dollars, when the invoice carries one. */
  amount?: number;
  /** The tracking/pay page, when PUBLIC_BASE_URL is configured. */
  payUrl?: string;
}

/** "Your final balance ($450) for ORD-000002 was due September 3." */
export function paymentDueSms(details: PaymentDueSmsDetails): SmsMessage {
  const amount =
    details.amount !== undefined
      ? ` (${new Intl.NumberFormat("en-US", {
          style: "currency",
          // The studio's one declared currency rather than a fifth hardcoded
          // "USD" — the trap `lib/currency.ts` exists to close.
          currency: STUDIO_CURRENCY,
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        }).format(details.amount)})`
      : "";
  return {
    to: details.to,
    body: compose([
      `Your ${details.stageLabel.toLowerCase()}${amount} for ${details.orderNumber} ${
        details.overdue ? "was" : "is"
      } due ${formatCalendarDateShort(details.dueDate)}.`,
      linkSentence("Pay", details.payUrl),
    ]),
  };
}

/** The details an appointment-reminder text needs. */
export interface AppointmentReminderSmsDetails {
  to: string;
  /** "fitting", "consultation" — the appointment type's own name, lowercased by
   * the caller only if the catalog gives it capitalized. */
  typeName: string;
  /** "today" / "tomorrow" / "on Monday, August 24", from the shared
   * `whenPhrase` — so the email and the text can't describe the same booking
   * differently. */
  whenPhrase: string;
  /** The time, already formatted in the studio's timezone ("10:00 AM"). */
  time: string;
  /** Where it is — the studio, the rink, or "online". */
  locationLabel: string;
  /** The signed manage link, when it can be built. */
  manageUrl?: string;
}

/** "Your fitting is tomorrow at 10:00 AM (The studio)." */
export function appointmentReminderSms(
  details: AppointmentReminderSmsDetails,
): SmsMessage {
  return {
    to: details.to,
    body: compose([
      `Your ${details.typeName} is ${details.whenPhrase} at ${details.time} (${details.locationLabel}).`,
      linkSentence("Reschedule or cancel", details.manageUrl),
    ]),
  };
}

/** The details an order-ready text needs. */
export interface OrderReadySmsDetails {
  to: string;
  /** The customer's first name — the only unbounded field in any of these. */
  firstName: string;
  orderNumber: string;
  /** The tracking page, when PUBLIC_BASE_URL is configured. */
  trackingUrl?: string;
}

/**
 * "Ada, ORD-000002 is finished and on its way to you."
 *
 * Worded for both outcomes on purpose. This fires at the "Ready for
 * delivery/pickup" stage, which a posted parcel and a collection at the studio
 * both reach — and the tracking page it links to already answers whichever
 * applies, carrier tracking or a pickup time. Saying "shipped" here would be
 * wrong for every skater who collects in person.
 */
export function orderReadySms(details: OrderReadySmsDetails): SmsMessage {
  const name = clampField(details.firstName, NAME_LIMIT);
  return {
    to: details.to,
    body: compose([
      `${name ? `${name}, y` : "Y"}our order ${details.orderNumber} is finished and ready.`,
      linkSentence("Delivery details", details.trackingUrl),
    ]),
  };
}
