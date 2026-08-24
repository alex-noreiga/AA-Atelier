// Waitlist use-case, independent of HTTP. The route handler calls this with
// already-validated input and turns the result into a response.
//
// Storage mirrors every other customer-request flow: a tagged row in the
// always-configured "Website Contact Messages" database, a best-effort Client
// CRM link, a best-effort acknowledgement to the customer and — unlike the
// newsletter opt-in, and like the transactional captures — a notification to the
// atelier. A waitlist entry is somebody actively asking for work: it needs
// triage, and it is the signal the atelier reopens the books on.
//
// This never creates an order and never holds a slot. Turning a waitlist entry
// into a commission is the atelier writing back when capacity frees, which is a
// conversation, not a queue position.

import { createWaitlistEntry } from "../lib/notion/waitlist.repository.js";
import {
  isoDateOnly,
  type CreateWaitlistInput,
  type WaitlistTarget,
} from "../lib/notion/waitlist.blocks.js";
import { upsertClientByEmail } from "../lib/notion/clients.repository.js";
import {
  waitlistConfirmationEmail,
  waitlistNotificationEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";
import { logger } from "../lib/logger.js";

/**
 * What the entry is for: the customer's own words for what they're skating, and
 * the date they need the piece by.
 *
 * Both are free text from the browser and neither is resolved against anything.
 * That is the deliberate scope of this feature: the studio can't keep a list of
 * every competition run nationally and internationally, and doesn't need one —
 * the skater knows theirs, and all the atelier needs is a label to group by and
 * a date to work the list in.
 */
function resolveTarget(input: CreateWaitlistInput): WaitlistTarget {
  const eventName = input.eventName?.trim() || undefined;
  const date = isoDateOnly(input.neededBy) || undefined;
  return {
    ...(eventName ? { eventName } : {}),
    ...(date ? { date } : {}),
  };
}

export async function joinWaitlist(
  input: CreateWaitlistInput,
): Promise<{ success: true }> {
  const target = resolveTarget(input);

  // Best-effort: mirror the customer into the Client CRM (dedupe by email) so
  // the entry links to a durable record and the atelier can see this is someone
  // who has been waiting. A `Lead`, not `Active` — they have asked for work, not
  // placed an order — matching the inquiry and back-in-stock writers. A CRM
  // failure must never fail the capture.
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
      "Failed to upsert Client CRM record; filing the waitlist entry without a client link",
    );
  }

  await createWaitlistEntry({ ...input, target }, undefined, clientPageId);

  // Best-effort mail, from the orders sender — this is about a commission, not
  // marketing. A send failure never fails the capture; the Notion row is the
  // record.
  const from = fromAddress("orders");
  await sendEmailBestEffort({
    ...waitlistConfirmationEmail(input, target),
    from,
  });

  const inbox = atelierInbox("orders");
  if (inbox) {
    await sendEmailBestEffort({
      ...waitlistNotificationEmail(input, target, inbox),
      from,
    });
  }

  return { success: true };
}
