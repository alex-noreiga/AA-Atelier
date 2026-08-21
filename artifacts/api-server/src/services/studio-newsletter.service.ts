// The studio dashboard's newsletter panel, HTTP-agnostic.
//
// A marketing opt-in lands in the same contact inbox as the five request kinds
// but is a different job: nobody answers it, someone puts the address on the
// mailing list. The app already tries that at capture time
// (`upsertAudienceContactBestEffort`), and that sync is BEST-EFFORT and
// self-gates off when `RESEND_AUDIENCE_ID` is unset — so an opt-in can be
// recorded in Notion and never reach the list, with nothing anywhere saying so.
// This panel is where that becomes visible, and fixable in one press.
//
// The one design decision everything else follows from: **membership is read
// from Resend, never stored.** A "added to the list" checkbox on the Notion row
// would record what somebody remembered to tick, and the capture-time sync
// would not tick it — so the single case worth catching, an opt-in that never
// synced, is exactly the one a marker would miss. Resend owns the list, so
// Resend is asked. Same rule the return refunds follow with Stripe, and the
// reason the Notion write here is only "I have dealt with this row".

import {
  listPendingNewsletterSignups,
  listHandledNewsletterSignups,
  findRequestById,
  setRequestStage,
} from "../lib/notion/requests.repository.js";
import {
  extractSignupSource,
  type NewsletterSignupRecord,
} from "../lib/notion/requests.schema.js";
import {
  audienceConfigured,
  listAudienceContacts,
  membershipIn,
  upsertAudienceContact,
  type AudienceSnapshot,
} from "../lib/resend/audience.js";
import { logger } from "../lib/logger.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";

/** Where an opt-in stands with the mailing list. `unknown` is its own answer:
 * "we could not ask", which must not be rendered as "not on the list".
 *
 * Whether a contact has since UNSUBSCRIBED is deliberately not modelled here.
 * Resend owns that — it attaches the one-click unsubscribe to every broadcast
 * and honours it — so someone who opted out is somebody the studio has nothing
 * left to do about, and a state nobody acts on is one more thing to reason
 * about for no gain. They read as `subscribed` (Resend has them) and so are
 * never offered the Add button, which is the behaviour that matters. */
export type SignupSubscription = "subscribed" | "absent" | "unknown";

/** One opt-in, plus the live answer to "did they reach the list?". */
export interface NewsletterSignupView extends NewsletterSignupRecord {
  subscription: SignupSubscription;
}

/** The audience itself, so the panel can explain an unknown column. */
export interface AudienceStatus {
  configured: boolean;
  unreachable?: boolean;
  contactCount?: number;
}

/** Attach each row's live membership. A null snapshot means we couldn't ask,
 * and a row with no email can't be looked up at all — both are `unknown`, so
 * neither shows an Add button that would fail. */
function withSubscription(
  records: NewsletterSignupRecord[],
  snapshot: AudienceSnapshot | null,
): NewsletterSignupView[] {
  return records.map((record) => ({
    ...record,
    subscription: record.email
      ? (membershipIn(snapshot, record.email) ?? "unknown")
      : "unknown",
  }));
}

/**
 * The panel: the opt-ins still to deal with, the recently filed ones, and the
 * state of the audience both are checked against.
 *
 * The audience read is best-effort. Notion and Resend are separate systems, and
 * a Resend outage should cost the atelier the subscribed/not column for one
 * page load — not the list of who opted in, which is the part Notion holds.
 */
export async function getNewsletterPanel(): Promise<{
  pending: NewsletterSignupView[];
  handled: NewsletterSignupView[];
  audience: AudienceStatus;
  truncated: boolean;
}> {
  const configured = audienceConfigured();

  const [pendingRead, handled, audienceRead] = await Promise.all([
    listPendingNewsletterSignups(),
    listHandledNewsletterSignups().catch((err: unknown) => {
      logger.warn(
        { err },
        "Failed to read the filed newsletter opt-ins; showing the pending ones only",
      );
      return [] as NewsletterSignupRecord[];
    }),
    listAudienceContacts().catch((err: unknown) => {
      logger.warn(
        { err },
        "Failed to read the Resend audience; the newsletter panel will report subscriptions as unknown",
      );
      return null;
    }),
  ]);

  return {
    pending: withSubscription(pendingRead.records, audienceRead),
    handled: withSubscription(handled, audienceRead),
    audience: {
      configured,
      // Configured but nothing came back ⇒ the read failed. An unconfigured
      // audience is a different state, and saying "unreachable" for it would
      // send the atelier looking for an outage instead of a setting.
      ...(configured && !audienceRead ? { unreachable: true } : {}),
      ...(audienceRead ? { contactCount: audienceRead.total } : {}),
    },
    truncated: pendingRead.truncated,
  };
}

/**
 * Add one opt-in to the audience, then file its row away.
 *
 * Resend first, Notion second, and deliberately not the other way round: an
 * opt-in left in the panel having already been added costs one wasted press
 * (the upsert is idempotent), while one filed away having never reached the
 * list costs a subscriber, silently, forever.
 *
 * Refused rather than attempted when the audience isn't configured (closing the
 * row would record a subscription that never happened) and when the row carries
 * no address. Either can still be dismissed through the ordinary request-state
 * operation.
 */
export async function subscribeNewsletterSignup(
  signupId: string,
): Promise<NewsletterSignupView> {
  const existing = await findRequestById(signupId);
  if (!existing) {
    throw new NotFoundError("That sign-up no longer exists.");
  }
  if (!existing.email) {
    throw new ConflictError(
      "This sign-up has no email address on it, so there's nobody to add. You can dismiss it instead.",
    );
  }
  if (!audienceConfigured()) {
    throw new ConflictError(
      "No Resend audience is configured, so nobody can be added to the mailing list yet. Set RESEND_AUDIENCE_ID and try again.",
    );
  }

  // An address Resend already holds is left alone — the row is simply filed
  // away. That keeps the press idempotent, and it is also what makes it
  // impossible to reach the upsert's re-subscribe path from this panel: someone
  // who opted out is already on the audience, so nothing is written for them.
  const snapshot = await listAudienceContacts();
  if (membershipIn(snapshot, existing.email) !== "subscribed") {
    await upsertAudienceContact(existing.email);
  }

  const updated = await setRequestStage(signupId, "closed");
  if (!updated) {
    throw new NotFoundError("That sign-up no longer exists.");
  }

  // The state write answers with the generic contact-row projection, so the
  // panel's own view is rebuilt from it — `source` included, which lives in the
  // subject rather than a property of its own.
  const source = extractSignupSource(updated.subject);

  return {
    id: updated.id,
    email: existing.email,
    subject: updated.subject,
    state: updated.state,
    subscription: "subscribed",
    ...(source ? { source } : {}),
    ...(updated.submittedAt ? { submittedAt: updated.submittedAt } : {}),
    ...(updated.notionUrl ? { notionUrl: updated.notionUrl } : {}),
  };
}
