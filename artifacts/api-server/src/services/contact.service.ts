// Contact-message use-case, independent of HTTP. The route handler calls this
// with already-validated input and turns the result (or thrown domain errors)
// into a response.

import { createContactMessage } from "../lib/notion/contact.repository.js";
import type { CreateContactInput } from "../lib/notion/contact.blocks.js";
import {
  contactAckEmail,
  contactNotificationEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";

export async function submitContactMessage(
  input: CreateContactInput,
): Promise<{ success: true }> {
  await createContactMessage(input);
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
