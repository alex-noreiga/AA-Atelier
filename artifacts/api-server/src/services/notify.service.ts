// Back-in-stock request use-case, independent of HTTP. The route handler calls
// this with already-validated input and turns the result (or thrown domain
// errors) into a response.

import { createBackInStockRequest } from "../lib/notion/notify.repository.js";
import type { CreateNotifyInput } from "../lib/notion/notify.blocks.js";
import {
  backInStockConfirmationEmail,
  backInStockNotificationEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { getAtelierInbox } from "../lib/resend/client.js";

export async function submitBackInStockRequest(
  input: CreateNotifyInput,
): Promise<{ success: true }> {
  await createBackInStockRequest(input);
  // Best-effort emails; a mail failure must not fail the request.
  await sendEmailBestEffort(backInStockConfirmationEmail(input));
  const inbox = getAtelierInbox();
  if (inbox) {
    await sendEmailBestEffort(backInStockNotificationEmail(input, inbox));
  }
  return { success: true };
}
