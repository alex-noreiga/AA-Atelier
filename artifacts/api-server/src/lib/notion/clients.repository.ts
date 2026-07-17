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

export const CLIENT_NAME_PROPERTY = "Client Name"; // title
export const CLIENT_EMAIL_PROPERTY = "Email"; // email
export const CLIENT_PHONE_PROPERTY = "Phone"; // phone_number
export const CLIENT_STATUS_PROPERTY = "Status"; // status
export const CLIENT_LAST_CONTACT_PROPERTY = "Last Contact"; // date

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
  const email = input.email.trim();
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
