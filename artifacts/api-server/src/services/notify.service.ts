// Back-in-stock request use-case, independent of HTTP. The route handler calls
// this with already-validated input and turns the result (or thrown domain
// errors) into a response.

import { createBackInStockRequest } from "../lib/notion/notify.repository.js";
import type { CreateNotifyInput } from "../lib/notion/notify.blocks.js";
import { upsertClientByEmail } from "../lib/notion/clients.repository.js";
import {
  backInStockConfirmationEmail,
  backInStockNotificationEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";
import { logger } from "../lib/logger.js";

export async function submitBackInStockRequest(
  input: CreateNotifyInput,
): Promise<{ success: true }> {
  // Best-effort: mirror the requester into the Client CRM (dedupe by email) and
  // link the request to that record. A back-in-stock request carries only an
  // email, so a new CRM row is named by the email and marked a "Lead". Never
  // fails the request (see the mailers below); no-ops when CRM is unconfigured.
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
      "Failed to upsert Client CRM record; filing the back-in-stock request without a client link",
    );
  }

  await createBackInStockRequest(input, undefined, clientPageId);
  // Best-effort emails; a mail failure must not fail the request. Back-in-stock
  // is grouped with the "orders" category (orders@).
  const from = fromAddress("orders");
  await sendEmailBestEffort({ ...backInStockConfirmationEmail(input), from });
  const inbox = atelierInbox("orders");
  if (inbox) {
    await sendEmailBestEffort({
      ...backInStockNotificationEmail(input, inbox),
      from,
    });
  }
  return { success: true };
}
