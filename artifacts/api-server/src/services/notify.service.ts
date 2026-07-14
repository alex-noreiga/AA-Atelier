// Back-in-stock request use-case, independent of HTTP. The route handler calls
// this with already-validated input and turns the result (or thrown domain
// errors) into a response.

import { createBackInStockRequest } from "../lib/notion/notify.repository.js";
import type { CreateNotifyInput } from "../lib/notion/notify.blocks.js";
import { backInStockConfirmationEmail } from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";

export async function submitBackInStockRequest(
  input: CreateNotifyInput,
): Promise<{ success: true }> {
  await createBackInStockRequest(input);
  // Best-effort confirmation email; a mail failure must not fail the request.
  await sendEmailBestEffort(backInStockConfirmationEmail(input));
  return { success: true };
}
