// Resend **Marketing** audience sync — the one place the app talks to Resend's
// Contacts API (everything else in this folder is transactional `send`). A
// newsletter opt-in is mirrored into a Resend Audience so that Audience becomes
// the sending list and the subscription authority: campaigns go out as Resend
// **Broadcasts** from the dashboard, and Resend owns unsubscribe (it attaches the
// one-click unsubscribe + `List-Unsubscribe` header to every broadcast). The
// Notion row + CRM Lead stay the internal customer record.
//
// Kept separate from `client.ts` (which is `send`-only) the same way `send.ts`
// is, and best-effort at the call site: the service wraps this so an audience
// hiccup never fails the opt-in, exactly like the CRM upsert and the mailers.

import { logger } from "../logger.js";
import { audienceId } from "./config.js";

const RESEND_BASE_URL = "https://api.resend.com";

type FetchImpl = (
  url: string,
  init?: RequestInit,
) => Response | Promise<Response>;

/** Injectable dependencies — real env + global `fetch` by default; overridden in
 *  tests so no network is touched. */
export interface AudienceDeps {
  apiKey?: string;
  audienceId?: string;
  fetchImpl?: FetchImpl;
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

/**
 * Add — or re-subscribe — an email to the configured Resend Audience.
 *
 * Self-gates to a no-op when `RESEND_API_KEY` or `RESEND_AUDIENCE_ID` is unset
 * (feature off ⇒ the opt-in is still captured in Notion), or the email is blank.
 *
 * Upsert semantics: create the contact with `unsubscribed: false`; if the create
 * is rejected because the contact already exists, PATCH it back to
 * `unsubscribed: false` by email — so someone who previously unsubscribed and
 * re-opts-in through the form is re-subscribed rather than silently dropped.
 * (Resend's create-on-existing behavior — 200 with the existing contact vs. a
 * 4xx — is handled by trying the PATCH on any non-ok create; verify against the
 * live API and simplify if create turns out to be a true upsert.)
 *
 * Throws on a genuine, unexpected failure so the caller's best-effort wrapper can
 * log it; returns normally on success or when self-gated.
 */
export async function upsertAudienceContact(
  email: string,
  deps: AudienceDeps = {},
): Promise<void> {
  const apiKey = deps.apiKey ?? process.env.RESEND_API_KEY ?? "";
  const audience = deps.audienceId ?? audienceId();
  const trimmed = email.trim();
  if (!apiKey || !audience || !trimmed) {
    return; // self-gate: audience sync is off / nothing to sync
  }
  const doFetch: FetchImpl = deps.fetchImpl ?? fetch;

  const contactsUrl = `${RESEND_BASE_URL}/audiences/${audience}/contacts`;

  const createResponse = await doFetch(contactsUrl, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({ email: trimmed, unsubscribed: false }),
  });

  if (createResponse.ok) {
    return;
  }

  // The contact likely already exists — re-subscribe it (a no-op if it was
  // already subscribed). Resend accepts the email in the path for PATCH.
  const patchResponse = await doFetch(
    `${contactsUrl}/${encodeURIComponent(trimmed)}`,
    {
      method: "PATCH",
      headers: authHeaders(apiKey),
      body: JSON.stringify({ unsubscribed: false }),
    },
  );

  if (patchResponse.ok) {
    return;
  }

  const createText = await createResponse.text().catch(() => "");
  const patchText = await patchResponse.text().catch(() => "");
  throw new Error(
    `Resend audience upsert failed: create ${createResponse.status} (${createText}); ` +
      `patch ${patchResponse.status} (${patchText})`,
  );
}

/**
 * Best-effort audience sync: never throws. Mirrors `sendEmailBestEffort` — the
 * service calls this so a Resend Contacts-API problem is logged and swallowed,
 * never turning a successful opt-in into a failure. Self-gated calls log nothing.
 */
export async function upsertAudienceContactBestEffort(
  email: string,
  deps: AudienceDeps = {},
): Promise<void> {
  try {
    await upsertAudienceContact(email, deps);
  } catch (err) {
    logger.warn(
      { err },
      "Failed to sync the newsletter opt-in to the Resend audience; " +
        "the opt-in is still recorded in Notion",
    );
  }
}

/**
 * What removing an email from the audience actually did.
 *
 * Three-valued for the same reason the studio panel's membership is: "we
 * couldn't ask" is its own answer. Telling a customer who asked to be erased
 * that they are off the mailing list when in truth the list was unreachable is
 * the one way this can be wrong that matters — so `unavailable` is reported and
 * the erasure request says the studio must do it by hand.
 */
export type AudienceRemoval = "unsubscribed" | "absent" | "unavailable";

/**
 * Unsubscribe an email from the configured Resend Audience.
 *
 * Unsubscribes rather than deletes, deliberately. Resend is the subscription
 * authority (it owns the one-click unsubscribe on every broadcast and honours
 * it), and a *deleted* contact is one Resend no longer knows to suppress — so
 * deleting the row would leave nothing standing between the customer and the
 * next time their address is added from an old list. `unsubscribed: true` is
 * the suppression the customer asked for; erasing the contact record itself is
 * part of what the studio actions by hand.
 *
 * Never throws: a self-gated (unconfigured) call, a 404 for a contact that was
 * never on the list, and a Resend failure are all answers rather than errors,
 * because this runs inside a request the customer must not lose over it.
 */
export async function unsubscribeAudienceContact(
  email: string,
  deps: AudienceDeps = {},
): Promise<AudienceRemoval> {
  const apiKey = deps.apiKey ?? process.env.RESEND_API_KEY ?? "";
  const audience = deps.audienceId ?? audienceId();
  const trimmed = email.trim();
  if (!apiKey || !audience || !trimmed) return "unavailable";

  const doFetch: FetchImpl = deps.fetchImpl ?? fetch;

  try {
    const response = await doFetch(
      `${RESEND_BASE_URL}/audiences/${audience}/contacts/${encodeURIComponent(trimmed)}`,
      {
        method: "PATCH",
        headers: authHeaders(apiKey),
        body: JSON.stringify({ unsubscribed: true }),
      },
    );

    if (response.ok) return "unsubscribed";
    if (response.status === 404) return "absent";

    const detail = await response.text().catch(() => "");
    logger.warn(
      { status: response.status, detail },
      "Could not unsubscribe the customer from the Resend audience; " +
        "the erasure request records that it must be done by hand",
    );
    return "unavailable";
  } catch (err) {
    logger.warn(
      { err },
      "Could not reach Resend to unsubscribe the customer; " +
        "the erasure request records that it must be done by hand",
    );
    return "unavailable";
  }
}

// --- Reading the audience back -------------------------------------------
//
// The studio's newsletter panel asks "did this opt-in actually reach the
// mailing list?", and the honest answer can only come from the list itself.
// A marker on the Notion row would say what someone remembered to tick, and
// the capture-time sync above — best-effort, and silently skipped when the
// audience is unconfigured — would not tick it, so the one case worth catching
// (an opt-in that never synced) is exactly the one a marker would miss. This
// is the same rule the return refunds follow with Stripe: the vendor holds the
// fact, our rows hold the paperwork.

/**
 * Where one email stands in the audience: on it, or not.
 *
 * Deliberately NOT three-valued. Resend also reports whether a contact has
 * unsubscribed, and this does not read it: Resend owns the subscription (it
 * attaches the one-click unsubscribe to every broadcast, and honours it), so
 * someone who opted out is simply somebody the studio has nothing left to do
 * about. Carrying that state would only put a distinction on the dashboard that
 * nobody acts on — and, because the panel offers its Add button on "not on the
 * list" alone, an opted-out contact is never offered one either way.
 */
export type AudienceMembership = "subscribed" | "absent";

/** The audience as the studio panel needs it: who is on it, and how many. */
export interface AudienceSnapshot {
  /** Lowercased emails. */
  contacts: Set<string>;
  total: number;
}

interface ResendContactRow {
  email?: unknown;
}

interface ResendContactsResponse {
  data?: ResendContactRow[];
}

/** Whether the audience sync is configured at all. Unset ⇒ the panel reports
 * every opt-in as `unknown` and says what to set, rather than showing a list
 * that reads as nobody being subscribed. */
export function audienceConfigured(deps: AudienceDeps = {}): boolean {
  const apiKey = deps.apiKey ?? process.env.RESEND_API_KEY ?? "";
  const audience = deps.audienceId ?? audienceId();
  return Boolean(apiKey && audience);
}

/**
 * Every contact on the configured audience, keyed by lowercased email.
 *
 * Returns `null` — never throws — when the sync isn't configured, so the
 * caller reports "unknown" rather than "absent"; the difference matters,
 * because "absent" is what puts an Add button in front of the atelier.
 *
 * Deliberately unpaginated: Resend's Contacts API returns the audience in one
 * response, and the free Marketing tier this runs on tops out at 1,000
 * contacts. If the list ever outgrows that, this is the place to page.
 */
export async function listAudienceContacts(
  deps: AudienceDeps = {},
): Promise<AudienceSnapshot | null> {
  const apiKey = deps.apiKey ?? process.env.RESEND_API_KEY ?? "";
  const audience = deps.audienceId ?? audienceId();
  if (!apiKey || !audience) return null;

  const doFetch: FetchImpl = deps.fetchImpl ?? fetch;
  const response = await doFetch(
    `${RESEND_BASE_URL}/audiences/${audience}/contacts`,
    { headers: authHeaders(apiKey) },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Resend audience read failed with status ${response.status}: ${detail}`,
    );
  }

  const body = (await response.json()) as ResendContactsResponse;
  const contacts = new Set<string>();
  for (const row of body.data ?? []) {
    if (typeof row.email !== "string") continue;
    const email = row.email.trim().toLowerCase();
    if (!email) continue;
    contacts.add(email);
  }

  return { contacts, total: contacts.size };
}

/** Where `email` stands in a snapshot. A null snapshot has no opinion, which
 * the caller renders as `unknown`. */
export function membershipIn(
  snapshot: AudienceSnapshot | null,
  email: string,
): AudienceMembership | null {
  if (!snapshot) return null;
  return snapshot.contacts.has(email.trim().toLowerCase())
    ? "subscribed"
    : "absent";
}
