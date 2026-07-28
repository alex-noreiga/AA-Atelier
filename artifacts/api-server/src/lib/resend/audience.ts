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
