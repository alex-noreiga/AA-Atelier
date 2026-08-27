// Client CRM upsert, keyed on the customer's email. Called best-effort from
// every customer touchpoint — custom orders, shop orders, contact-form
// inquiries, back-in-stock and measurement-change requests — so the CRM stays
// the single customer record without manual data entry: an existing client
// (same email) is reused — deduping repeat customers — and only its
// `Last Contact` is refreshed; a new email creates a client row. The
// row↔client link itself is written on the *other* side (a `Client` relation on
// the order / shop-order / contact-message page, see the respective `blocks.ts`),
// which auto-populates the CRM's reverse relation.
//
// The `Client CRM` database id comes from the optional
// `NOTION_CLIENT_CRM_DATABASE_ID`. When it's unset the client's `databaseId` is
// empty and this returns null (the caller then just skips linking), so the order
// flow is unchanged until the env var is configured.

import { getClientCrmNotionClient, type NotionClient } from "./client.js";
import { normalizeEmail } from "../email.js";

export const CLIENT_NAME_PROPERTY = "Client Name"; // title
export const CLIENT_EMAIL_PROPERTY = "Email"; // email
export const CLIENT_PHONE_PROPERTY = "Phone"; // phone_number
export const CLIENT_STATUS_PROPERTY = "Status"; // status
export const CLIENT_LAST_CONTACT_PROPERTY = "Last Contact"; // date

// Referral & returning-skater rewards (see services/rewards.service.ts). All
// live on the existing CRM row — the customer's durable record — so the feature
// adds no new database. The two checkboxes are the fast idempotency guards
// (backed by Stripe's own promo-code uniqueness); the *Code properties are
// audit-only, so the atelier can resend a code if a best-effort email is lost.
export const CLIENT_REFERRAL_CODE_PROPERTY = "Referral Code"; // rich_text
export const CLIENT_REFERRED_BY_PROPERTY = "Referred By Email"; // rich_text
export const CLIENT_REFERRAL_REWARDED_PROPERTY = "Referral Rewarded"; // checkbox
// The customer's FIRST paid order number. Non-empty ⇒ they've paid before; the
// value identifies which order, so the returning-skater reward fires on a
// genuinely different order — not on a webhook retry or a later payment stage of
// the same order.
export const CLIENT_FIRST_PAID_ORDER_PROPERTY = "First Paid Order"; // rich_text
export const CLIENT_RETURNING_REWARD_ISSUED_PROPERTY =
  "Returning Reward Issued"; // checkbox
export const CLIENT_REFERRAL_CREDIT_CODE_PROPERTY = "Referral Credit Code"; // rich_text
export const CLIENT_RETURNING_DISCOUNT_CODE_PROPERTY =
  "Returning Discount Code"; // rich_text

// Opt-in to transactional text alerts (see services/sms.service.ts). Consent
// lives on the CRM row rather than on an order because it is a fact about the
// PERSON, not about one commission: the deposit reminder, the fitting reminder
// and the order-ready text are three different flows that must all read the
// same answer, and a customer who opts in on their second order has not opted
// in twice. The number is the row's existing `Phone` — one number per customer,
// which is also what makes revoking consent a single edit.
export const CLIENT_SMS_CONSENT_PROPERTY = "SMS Consent"; // checkbox
// When they agreed. Written alongside the checkbox because a consent record
// that can't say WHEN is not much of a record — and it is the atelier's answer
// if a customer ever asks why they are being texted.
export const CLIENT_SMS_CONSENT_AT_PROPERTY = "SMS Consent At"; // date

// Default status for a newly-created client. A customer who reached us by
// placing an order (custom or shop) is Active; a contact-form inquiry or a
// back-in-stock request is a cold Lead — the caller passes `status` to say which.
const NEW_CLIENT_STATUS = "Active";

export interface ClientUpsertInput {
  fullName: string;
  email: string;
  phone?: string;
  /** Status for a *new* client row; defaults to "Active". Ignored for an
   *  existing client — its status is left as the atelier maintains it. */
  status?: string;
}

interface CrmQueryResponse {
  results: Array<{ id: string }>;
}

/** Today's date as a Notion date `start` value (YYYY-MM-DD). */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Find-or-create a Client CRM row for this customer's email and return its
 * Notion page id, or null when the CRM database isn't configured or the email is
 * blank (the caller then skips linking). An existing client is reused so repeat
 * customers don't duplicate; only `Last Contact` is refreshed — name, phone, and
 * status are left as the atelier maintains them.
 */
export async function upsertClientByEmail(
  input: ClientUpsertInput,
  client: NotionClient = getClientCrmNotionClient(),
): Promise<string | null> {
  const email = normalizeEmail(input.email);
  if (!client.databaseId || !email) {
    return null;
  }

  const queryResponse = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: CLIENT_EMAIL_PROPERTY,
          email: { equals: email },
        },
        page_size: 1,
      }),
    },
  );

  if (!queryResponse.ok) {
    throw new Error(
      `Notion client lookup failed with status ${queryResponse.status}`,
    );
  }

  const existing = ((await queryResponse.json()) as CrmQueryResponse)
    .results[0];
  if (existing) {
    const patchResponse = await client.fetch(`/v1/pages/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          [CLIENT_LAST_CONTACT_PROPERTY]: { date: { start: today() } },
        },
      }),
    });
    if (!patchResponse.ok) {
      const errorText = await patchResponse.text();
      throw new Error(
        `Notion client update failed with status ${patchResponse.status}: ${errorText}`,
      );
    }
    return existing.id;
  }

  // Some entry points (a back-in-stock request) know only the email; fall back
  // to it for the title so the CRM row is never nameless.
  const clientName = input.fullName.trim() || email;
  const properties: Record<string, unknown> = {
    [CLIENT_NAME_PROPERTY]: {
      title: [{ text: { content: clientName } }],
    },
    [CLIENT_EMAIL_PROPERTY]: { email },
    [CLIENT_STATUS_PROPERTY]: {
      status: { name: input.status ?? NEW_CLIENT_STATUS },
    },
    [CLIENT_LAST_CONTACT_PROPERTY]: { date: { start: today() } },
  };
  const phone = input.phone?.trim();
  if (phone) {
    properties[CLIENT_PHONE_PROPERTY] = { phone_number: phone };
  }

  const createResponse = await client.fetch("/v1/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: client.databaseId },
      properties,
    }),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throw new Error(
      `Notion client creation failed with status ${createResponse.status}: ${errorText}`,
    );
  }

  const created = (await createResponse.json()) as { id: string };
  return created.id;
}

// ---------------------------------------------------------------------------
// Rewards: reads + a generic property patch, used by services/rewards.service.ts.
//
// `upsertClientByEmail` is deliberately left untouched (it only refreshes
// `Last Contact` on an existing row). Reward state is read and written through
// the dedicated helpers below so the upsert's "don't clobber the atelier's
// edits" contract stays intact.
// ---------------------------------------------------------------------------

interface NotionPage {
  id: string;
  properties: Record<string, unknown>;
}

interface CrmPageQueryResponse {
  results: NotionPage[];
}

/** The plain text of a Notion rich_text property, or "" when empty/absent. */
function richText(prop: unknown): string {
  const rt = (prop as { rich_text?: Array<{ plain_text?: string }> } | null)
    ?.rich_text;
  return rt?.map((t) => t.plain_text ?? "").join("") ?? "";
}

/** A Notion checkbox property's value (absent/unchecked ⇒ false). */
function checkbox(prop: unknown): boolean {
  return Boolean((prop as { checkbox?: boolean } | null)?.checkbox);
}

/** A Notion email property's value, or "" when absent. */
function emailValue(prop: unknown): string {
  return (prop as { email?: string | null } | null)?.email ?? "";
}

/** The reward-relevant fields of a Client CRM row. */
export interface ClientRewardRow {
  pageId: string;
  email: string;
  referralCode: string;
  referredByEmail: string;
  referralRewarded: boolean;
  /** The order number of the customer's first paid order, or "" if none yet. */
  firstPaidOrder: string;
  returningRewardIssued: boolean;
  returningDiscountCode: string;
}

function toRewardRow(page: NotionPage): ClientRewardRow {
  const p = page.properties;
  return {
    pageId: page.id,
    email: emailValue(p[CLIENT_EMAIL_PROPERTY]),
    referralCode: richText(p[CLIENT_REFERRAL_CODE_PROPERTY]),
    referredByEmail: richText(p[CLIENT_REFERRED_BY_PROPERTY]),
    referralRewarded: checkbox(p[CLIENT_REFERRAL_REWARDED_PROPERTY]),
    firstPaidOrder: richText(p[CLIENT_FIRST_PAID_ORDER_PROPERTY]),
    returningRewardIssued: checkbox(p[CLIENT_RETURNING_REWARD_ISSUED_PROPERTY]),
    returningDiscountCode: richText(p[CLIENT_RETURNING_DISCOUNT_CODE_PROPERTY]),
  };
}

/**
 * The reward-state row for a client email, or null when the CRM db is
 * unconfigured, the email is blank, or no client matches. Reads by the same
 * normalized email the CRM is keyed on.
 */
export async function getClientRewardRowByEmail(
  email: string,
  client: NotionClient = getClientCrmNotionClient(),
): Promise<ClientRewardRow | null> {
  const normalized = normalizeEmail(email);
  if (!client.databaseId || !normalized) return null;

  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: CLIENT_EMAIL_PROPERTY,
          email: { equals: normalized },
        },
        page_size: 1,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Notion client reward lookup failed with status ${response.status}`,
    );
  }
  const page = ((await response.json()) as CrmPageQueryResponse).results[0];
  return page ? toRewardRow(page) : null;
}

/**
 * Find a client by their shareable referral code (rich_text exact match) and
 * return its page id + email, or null when the CRM db is unconfigured, the code
 * is blank, or none matches. Used to resolve the referrer when a new skater
 * submits a code.
 */
export async function findClientByReferralCode(
  code: string,
  client: NotionClient = getClientCrmNotionClient(),
): Promise<{ pageId: string; email: string } | null> {
  const trimmed = code.trim();
  if (!client.databaseId || !trimmed) return null;

  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: CLIENT_REFERRAL_CODE_PROPERTY,
          rich_text: { equals: trimmed },
        },
        page_size: 1,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Notion referral-code lookup failed with status ${response.status}`,
    );
  }
  const page = ((await response.json()) as CrmPageQueryResponse).results[0];
  if (!page) return null;
  return {
    pageId: page.id,
    email: emailValue(page.properties[CLIENT_EMAIL_PROPERTY]),
  };
}

// ---------------------------------------------------------------------------
// The customer's own view of their CRM row, for a data export.
//
// Deliberately a second read rather than a widening of `getClientRewardRowByEmail`:
// that one exists to drive reward idempotency and reads the fields that decide
// it, and giving it fields nobody needs for that decision would blur what it is
// for. This one reads the contact card — the personal data the studio holds
// about a person, which is the question an export answers.
// ---------------------------------------------------------------------------

/** The Client CRM row as the customer is entitled to see it. Every field is
 * optional: a CRM row is created from whatever a touchpoint knew, so most rows
 * carry only a name and an email. The rollups (order count, lifetime value)
 * are deliberately absent — they are sums over the orders the export already
 * lists in full, and the app has never read them. */
export interface ClientProfileRow {
  name: string;
  email: string;
  phone: string;
  status: string;
  lastContact: string;
  referralCode: string;
  referredByEmail: string;
  firstPaidOrder: string;
}

/** The plain text of a Notion title property, or "" when empty/absent. */
function titleText(prop: unknown): string {
  const title = (prop as { title?: Array<{ plain_text?: string }> } | null)
    ?.title;
  return (title?.map((t) => t.plain_text ?? "").join("") ?? "").trim();
}

function phoneValue(prop: unknown): string {
  return (
    (prop as { phone_number?: string | null } | null)?.phone_number ?? ""
  ).trim();
}

function statusValue(prop: unknown): string {
  return (
    (prop as { status?: { name?: string } | null } | null)?.status?.name ?? ""
  ).trim();
}

function dateStart(prop: unknown): string {
  return (
    (prop as { date?: { start?: string } | null } | null)?.date?.start ?? ""
  ).trim();
}

/**
 * The customer's Client CRM row, or null when the CRM database isn't
 * configured, the email is blank, or no row matches. Keyed on the same
 * normalized email every other CRM read uses, so a differently-cased address
 * still finds its record.
 */
export async function findClientProfileByEmail(
  email: string,
  client: NotionClient = getClientCrmNotionClient(),
): Promise<ClientProfileRow | null> {
  const normalized = normalizeEmail(email);
  if (!client.databaseId || !normalized) return null;

  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: CLIENT_EMAIL_PROPERTY,
          email: { equals: normalized },
        },
        page_size: 1,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Notion client profile lookup failed with status ${response.status}`,
    );
  }

  const page = ((await response.json()) as CrmPageQueryResponse).results[0];
  if (!page) return null;

  const p = page.properties;
  return {
    name: titleText(p[CLIENT_NAME_PROPERTY]),
    email: emailValue(p[CLIENT_EMAIL_PROPERTY]),
    phone: phoneValue(p[CLIENT_PHONE_PROPERTY]),
    status: statusValue(p[CLIENT_STATUS_PROPERTY]),
    lastContact: dateStart(p[CLIENT_LAST_CONTACT_PROPERTY]),
    referralCode: richText(p[CLIENT_REFERRAL_CODE_PROPERTY]),
    referredByEmail: richText(p[CLIENT_REFERRED_BY_PROPERTY]),
    firstPaidOrder: richText(p[CLIENT_FIRST_PAID_ORDER_PROPERTY]),
  };
}

// ---------------------------------------------------------------------------
// Text-message consent: the read the send paths gate on, and the write the
// intake records.
//
// A third read rather than a widening of the two above, for the reason the
// profile read gives: each exists to answer one question, and a read that
// answers three is a read nobody can reason about. This one answers "may we
// text this customer, and on what number?".
// ---------------------------------------------------------------------------

/** Whether the studio may text this customer, and the number to use. */
export interface ClientSmsContact {
  pageId: string;
  /** The number as the customer typed it — normalized to E.164 by the caller
   * (`services/sms.ts`), which is where the "unreadable number ⇒ no text" rule
   * lives. */
  phone: string;
  consented: boolean;
}

/**
 * The customer's text-message consent + number, or null when the CRM database
 * isn't configured, the email is blank, or no row matches.
 *
 * Null and `consented: false` mean the same thing to every caller — no text —
 * so this deliberately doesn't distinguish them. Everything about it fails
 * CLOSED: an absent property, an unticked box or a missing row all read as "no
 * consent on file", because the cost of being wrong in the other direction is
 * texting someone who never agreed to be texted.
 */
export async function findClientSmsContactByEmail(
  email: string,
  client: NotionClient = getClientCrmNotionClient(),
): Promise<ClientSmsContact | null> {
  const normalized = normalizeEmail(email);
  if (!client.databaseId || !normalized) return null;

  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: CLIENT_EMAIL_PROPERTY,
          email: { equals: normalized },
        },
        page_size: 1,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Notion client SMS lookup failed with status ${response.status}`,
    );
  }

  const page = ((await response.json()) as CrmPageQueryResponse).results[0];
  if (!page) return null;
  return {
    pageId: page.id,
    phone: phoneValue(page.properties[CLIENT_PHONE_PROPERTY]),
    consented: checkbox(page.properties[CLIENT_SMS_CONSENT_PROPERTY]),
  };
}

/**
 * Record (or revoke) a customer's text-message consent on their CRM row.
 *
 * Granting also writes the number, which is the load-bearing half: a CRM row
 * created by a contact-form inquiry carries no phone, and `upsertClientByEmail`
 * only ever writes one on CREATE — so without this an existing customer could
 * tick the box at intake and still never be textable.
 *
 * Revoking clears the checkbox and leaves the date and the number alone: the
 * date is the record of a consent that genuinely was given, and the number is
 * the atelier's ordinary contact detail, not something the SMS feature owns.
 */
export async function setClientSmsConsent(
  pageId: string,
  consent: { consented: boolean; phone?: string },
  client: NotionClient = getClientCrmNotionClient(),
): Promise<void> {
  const properties: Record<string, unknown> = {
    [CLIENT_SMS_CONSENT_PROPERTY]: { checkbox: consent.consented },
  };
  if (consent.consented) {
    properties[CLIENT_SMS_CONSENT_AT_PROPERTY] = { date: { start: today() } };
    const phone = consent.phone?.trim();
    if (phone) {
      properties[CLIENT_PHONE_PROPERTY] = { phone_number: phone };
    }
  }
  await patchClientProperties(pageId, properties, client);
}

/**
 * PATCH arbitrary properties onto a Client CRM page. The generic write path for
 * reward state (referral code, the idempotency checkboxes, the audit codes),
 * kept apart from `upsertClientByEmail` so that function never mutates fields
 * the atelier maintains.
 */
export async function patchClientProperties(
  pageId: string,
  properties: Record<string, unknown>,
  client: NotionClient = getClientCrmNotionClient(),
): Promise<void> {
  if (!client.databaseId || !pageId) return;
  const response = await client.fetch(`/v1/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion client property update failed with status ${response.status}: ${errorText}`,
    );
  }
}
