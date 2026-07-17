// Contact-message use-case, independent of HTTP. The route handler calls this
// with already-validated input and turns the result (or thrown domain errors)
// into a response.

import { createContactMessage } from "../lib/notion/contact.repository.js";
import type { CreateContactInput } from "../lib/notion/contact.blocks.js";
import { upsertClientByEmail } from "../lib/notion/clients.repository.js";
import {
  contactAckEmail,
  contactNotificationEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";
import { logger } from "../lib/logger.js";

export async function submitContactMessage(
  input: CreateContactInput,
): Promise<{ success: true }> {
  // Best-effort: mirror the enquirer into the Client CRM (dedupe by email) and
  // link the message to that record, so the CRM is the single customer store
  // rather than name/email re-typed here. A new contact is a cold "Lead". A CRM
  // failure must never fail the submit — swallow and log, like the mailers below
  // — and when the CRM db isn't configured the upsert returns null (no link).
  let clientPageId: string | undefined;
  try {
    clientPageId =
      (await upsertClientByEmail({
        fullName: input.name,
        email: input.email,
        phone: input.phone,
        status: "Lead",
      })) ?? undefined;
  } catch (err) {
    logger.warn(
      { err },
      "Failed to upsert Client CRM record; filing the contact message without a client link",
    );
  }

  await createContactMessage(input, undefined, clientPageId);
  // Best-effort emails; a mail failure must not fail the submit. Contact mail
  // uses the "contact" category (hello@).
  const from = fromAddress("contact");
  await sendEmailBestEffort({ ...contactAckEmail(input), from });
  const inbox = atelierInbox("contact");
  if (inbox) {
    await sendEmailBestEffort({
      ...contactNotificationEmail(input, inbox),
      from,
    });
  }
  return { success: true };
}
