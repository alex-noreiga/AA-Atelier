// Contact-message use-case, independent of HTTP. The route handler calls this
// with already-validated input and turns the result (or thrown domain errors)
// into a response.

import { createContactMessage } from "../lib/notion/contact.repository.js";
import type { CreateContactInput } from "../lib/notion/contact.blocks.js";
import { contactAckEmail } from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";

export async function submitContactMessage(
  input: CreateContactInput,
): Promise<{ success: true }> {
  await createContactMessage(input);
  // Best-effort acknowledgement email; a mail failure must not fail the submit.
  await sendEmailBestEffort(contactAckEmail(input));
  return { success: true };
}
