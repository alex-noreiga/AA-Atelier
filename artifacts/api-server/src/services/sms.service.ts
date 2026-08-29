// Text-message notifications: who may be texted, and the one path every send
// goes through.
//
// The card this implements ("opt-in text alerts for deposit due, fitting
// tomorrow, and order shipped, alongside email") is really two features, and
// this file is the seam between them: an OPT-IN, recorded once per customer on
// their Client CRM row, and three SEND SITES that each already know when to
// notify somebody. Neither send site should have to know how consent is stored,
// and consent should not have to know what a payment stage is — so both meet
// here.
//
// Four rules carry it:
//
//  1. **Consent is a fact about the person, not the order.** It lives on the CRM
//     row, keyed on the same normalized email every other CRM read uses, so a
//     customer who opts in on their second commission has one answer on file,
//     not two. See `.agents/memory/sms-notifications.md`.
//
//  2. **Everything fails closed.** No Twilio, no CRM, no row, no tick, no
//     readable number — all of them mean "no text", quietly. This is the
//     opposite of `services/capacity.ts`, which fails open, and for the opposite
//     reason: there, refusing a customer we could have served is the costly
//     mistake; here, texting someone who never agreed is.
//
//  3. **A text never fails the thing it is reporting on.** Every send is
//     best-effort and swallowed. The email carrying the same news has already
//     gone out (or is about to), so the worst case is a notification that
//     reached one channel instead of two — which is why, unlike a rejected
//     email, a rejected text is deliberately not escalated to the alert inbox.
//
//  4. **The carrier's record of an opt-out beats ours.** When Twilio refuses
//     because the customer replied STOP, the consent checkbox that contradicts
//     it is cleared on the spot. Otherwise the studio would text a number every
//     night that can never be delivered to, while the CRM went on claiming
//     permission. Same instinct as "Stripe is the source of truth for money —
//     the Notion markers are not".

import {
  findClientSmsContactByEmail,
  setClientSmsConsent,
  upsertClientByEmail,
} from "../lib/notion/clients.repository.js";
import { smsConfigured } from "../lib/twilio/client.js";
import { sendSmsBestEffort, type SmsSendResult } from "../lib/twilio/send.js";
import type { SmsMessage } from "../lib/twilio/client.js";
import { toE164 } from "./sms.js";
import { logger } from "../lib/logger.js";

/** Why a customer wasn't texted, for the caller's own reporting. Every value
 * but `sent` is an ordinary outcome, not a fault. */
export type TextOutcome =
  | "sent"
  | "not-configured"
  | "no-consent"
  | "no-number"
  | "unsubscribed"
  | "failed";

/**
 * Record that a customer has opted in to text alerts (and make sure the number
 * they gave is on their CRM row).
 *
 * Best-effort in every direction: no CRM configured, a Notion hiccup, a blank
 * email — none of them may fail the order this rides on. A consent that doesn't
 * get written costs the customer some texts they asked for, which the atelier
 * can fix by ticking the box; the order itself is untouched either way.
 *
 * Note it is only ever called with `consented: true` from intake. There is no
 * "untick it because they left the box blank" branch, deliberately: an unticked
 * box on a later order means "I didn't ask for anything new here", not "revoke
 * what I agreed to last time" — and reading it as a revocation would let a
 * second commission silently switch off the first one's alerts.
 */
export async function recordSmsConsent(input: {
  email: string;
  phone: string;
  fullName?: string;
  /** The customer's CRM page id, when the caller has already resolved one.
   * The order flow has: it upserts the client before creating the order, so
   * passing it here saves a second query for the row we just looked up. */
  clientPageId?: string;
  /** Status for a CRM row this creates. Defaults to the upsert's own "Active",
   * which is right for someone who has just placed an order; a booking passes
   * "Lead", since a consultation is somebody who hasn't bought anything yet.
   * Ignored for a row that already exists, like every other status write. */
  status?: string;
}): Promise<void> {
  // A consent with no number to attach it to records a permission we could
  // never act on — and would leave a ticked box on a row nothing can text.
  // Fail closed, like every other gate on this path.
  if (!input.phone.trim()) {
    logger.warn(
      "SMS consent given with no phone number; not recording it (there would be nothing to text)",
    );
    return;
  }

  try {
    const pageId =
      input.clientPageId ??
      (await upsertClientByEmail({
        fullName: input.fullName ?? "",
        email: input.email,
        phone: input.phone,
        ...(input.status ? { status: input.status } : {}),
      }));
    if (!pageId) return; // No CRM configured — nothing to record consent on.
    await setClientSmsConsent(pageId, {
      consented: true,
      phone: input.phone,
    });
  } catch (err) {
    logger.warn(
      { err },
      "Failed to record SMS consent on the Client CRM; the order is unaffected",
    );
  }
}

/**
 * Send one customer a text, if they have agreed to be texted.
 *
 * The caller supplies a builder rather than a finished message because the
 * recipient number isn't known until consent has been resolved — so this hands
 * the E.164 number back and lets the caller's own copy builder finish the job.
 *
 * Never throws. Returns what happened so a nightly pass can report it, and
 * clears a consent Twilio tells us has been revoked (rule 4 in the header).
 */
export async function textCustomer(
  email: string,
  build: (to: string) => SmsMessage,
): Promise<TextOutcome> {
  // Cheapest gate first: an install that never wired Twilio does no Notion read
  // per recipient on every nightly pass.
  if (!smsConfigured()) return "not-configured";

  let contact;
  try {
    contact = await findClientSmsContactByEmail(email);
  } catch (err) {
    logger.warn(
      { err },
      "Couldn't read SMS consent from the Client CRM; sending no text",
    );
    return "failed";
  }
  if (!contact || !contact.consented) return "no-consent";

  const to = toE164(contact.phone);
  if (!to) {
    // Worth a line in the log: the customer asked to be texted and can't be,
    // and the fix (correct the number on their CRM row) is the atelier's.
    logger.warn(
      { pageId: contact.pageId },
      "Customer consented to texts but their phone number can't be read as a number; sending no text",
    );
    return "no-number";
  }

  const result: SmsSendResult = await sendSmsBestEffort(build(to));
  if (result === "unsubscribed") {
    // They replied STOP. Stop asking — see rule 4.
    try {
      await setClientSmsConsent(contact.pageId, { consented: false });
    } catch (err) {
      logger.warn(
        { err, pageId: contact.pageId },
        "Couldn't clear SMS consent after Twilio reported the recipient opted out",
      );
    }
    return "unsubscribed";
  }
  if (result === "sent") return "sent";
  return result === "unconfigured" ? "not-configured" : "failed";
}
