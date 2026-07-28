// Newsletter opt-in use-case, independent of HTTP. The route handler calls this
// with already-validated input and turns the result (or thrown domain errors)
// into a response.
//
// Storage mirrors the back-in-stock flow: the durable record is a tagged row in
// the always-configured "Website Contact Messages" database, and the Client CRM
// link is a best-effort add-on that dedupes the subscriber by email. The one
// deliberate difference from the transactional flows: there is NO internal
// atelier notification. A mailing-list opt-in needs no triage the way an inquiry
// or a restock request does, and a per-signup email to the studio inbox would be
// pure noise as the list grows — the Notion row (and CRM lead) is the record.

import { createNewsletterSubscription } from "../lib/notion/newsletter.repository.js";
import type { CreateNewsletterInput } from "../lib/notion/newsletter.blocks.js";
import { upsertClientByEmail } from "../lib/notion/clients.repository.js";
import { newsletterWelcomeEmail } from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { upsertAudienceContactBestEffort } from "../lib/resend/audience.js";
import { fromAddress } from "../lib/resend/config.js";
import { logger } from "../lib/logger.js";

export async function subscribeToNewsletter(
  input: CreateNewsletterInput,
): Promise<{ success: true }> {
  // Best-effort: mirror the subscriber into the Client CRM (dedupe by email) and
  // link the opt-in row to that record, so the CRM is the single customer store.
  // A newsletter opt-in carries only an email, so a new CRM row is named by the
  // email and marked a "Lead". A CRM failure must never fail the opt-in — swallow
  // and log, like the mailer below — and when the CRM db isn't configured the
  // upsert returns null (no link).
  let clientPageId: string | undefined;
  try {
    clientPageId =
      (await upsertClientByEmail({
        fullName: "",
        email: input.email,
        status: "Lead",
      })) ?? undefined;
  } catch (err) {
    logger.warn(
      { err },
      "Failed to upsert Client CRM record; filing the newsletter opt-in without a client link",
    );
  }

  await createNewsletterSubscription(input, undefined, clientPageId);

  // Best-effort welcome; a mail failure must not fail the opt-in. Marketing mail
  // sends from the "contact" category (hello@), keeping it off orders@.
  await sendEmailBestEffort({
    ...newsletterWelcomeEmail(input),
    from: fromAddress("contact"),
  });

  // Best-effort: mirror the subscriber into the Resend Audience — the sending
  // list + unsubscribe authority that campaigns (Resend Broadcasts) go out
  // against. Self-gates off when RESEND_AUDIENCE_ID is unset, and never fails the
  // opt-in (the Notion row is the record either way).
  await upsertAudienceContactBestEffort(input.email);

  return { success: true };
}
