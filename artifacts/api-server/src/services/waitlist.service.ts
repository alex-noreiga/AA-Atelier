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
import { listUpcomingCompetitions } from "../lib/notion/competitions.repository.js";
import { upsertClientByEmail } from "../lib/notion/clients.repository.js";
import {
  waitlistConfirmationEmail,
  waitlistNotificationEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";
import { logger } from "../lib/logger.js";

/**
 * Resolve what the entry is for, server-side.
 *
 * A picked `eventId` is resolved back against the live competition list and the
 * event's OWN name and date are used — the client's `eventName` is ignored
 * entirely in that case. This matters for the same reason checkout reprices the
 * cart: a label the browser sent is a label the browser chose, and an inbox the
 * atelier sorts by event is only worth sorting if the event names are the
 * atelier's own. An id that resolves to nothing (a competition archived between
 * the form loading and the submit) degrades to the typed name, so the entry is
 * still captured with whatever the customer told us.
 *
 * The date is the event's when there is one and the customer's `neededBy`
 * otherwise, so the atelier can work the list in date order either way.
 */
async function resolveTarget(
  input: CreateWaitlistInput,
): Promise<WaitlistTarget> {
  const neededBy = isoDateOnly(input.neededBy) || undefined;
  const typed = input.eventName?.trim() || undefined;

  if (input.eventId) {
    try {
      const events = await listUpcomingCompetitions();
      const match = events.find((event) => event.id === input.eventId);
      if (match) {
        return { eventName: match.name, date: match.date };
      }
    } catch (err) {
      // The competitions read is already degrade-safe, but a throw here must
      // not cost the entry — the customer's own words are enough to act on.
      logger.warn(
        { err },
        "Failed to resolve the waitlist event; recording the entry as typed",
      );
    }
  }

  return {
    ...(typed ? { eventName: typed } : {}),
    ...(neededBy ? { date: neededBy } : {}),
  };
}

export async function joinWaitlist(
  input: CreateWaitlistInput,
): Promise<{ success: true }> {
  const target = await resolveTarget(input);

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
