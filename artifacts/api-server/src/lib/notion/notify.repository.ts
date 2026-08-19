// Back-in-stock request persistence. These share the "Website Contact Messages"
// database with contact-form messages — same inbox, distinguished by the
// "Request type" property — so this reuses the contact client and needs no
// database id of its own.

import {
  getContactNotionClient,
  assertDatabaseConfigured,
  type NotionClient,
} from "./client.js";
import {
  buildNotifyProperties,
  NOTIFY_ITEM_PROPERTY,
  NOTIFY_REQUEST_TYPE,
  NOTIFY_SIZE_PROPERTY,
  NOTIFY_TYPE_PROPERTY,
  type CreateNotifyInput,
} from "./notify.blocks.js";
import { CONTACT_EMAIL_PROPERTY } from "./contact.blocks.js";
import { scanDatabase } from "./scan.js";

function assertConfigured(client: NotionClient): void {
  assertDatabaseConfigured(
    client,
    "NOTION_CONTACT_DATABASE_ID is not configured for the contact database",
  );
}

export async function createBackInStockRequest(
  data: CreateNotifyInput,
  client: NotionClient = getContactNotionClient(),
  clientPageId?: string,
): Promise<void> {
  assertConfigured(client);

  const body: Record<string, unknown> = {
    parent: { database_id: client.databaseId },
    properties: buildNotifyProperties(data, clientPageId),
  };

  const response = await client.fetch("/v1/pages", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion back-in-stock request creation failed with status ${response.status}: ${errorText}`,
    );
  }
}

// --- Restock alerts (the read side) ---------------------------------------
//
// When a piece comes back in stock, the alert flow reads the waiting requests
// back out of this same inbox. There is deliberately NO marker property here:
// "already alerted" is an app-owned fact kept in Postgres (`restock_alerts`), so
// this database needs nothing added for the feature and the atelier can't
// un-tick a row into a second email. The consequence is that this reads EVERY
// back-in-stock row ever filed and lets the claim decide — which is why it goes
// through the bounded `scanDatabase` rather than an open cursor loop.

/** One filed back-in-stock request, as the alert flow needs it. */
export interface PendingRestockRequest {
  /** The Notion page id — the key the Postgres alert claim is made against. */
  pageId: string;
  email: string;
  /** The inventory row's `Item Name`, as stored when the request was filed. */
  item: string;
  /** The size band asked about, or "" when the whole piece was sold out. */
  size: string;
}

interface RestockRequestRow {
  id: string;
  properties?: {
    [CONTACT_EMAIL_PROPERTY]?: { email?: string | null };
    [NOTIFY_ITEM_PROPERTY]?: { rich_text?: Array<{ plain_text: string }> };
    [NOTIFY_SIZE_PROPERTY]?: { rich_text?: Array<{ plain_text: string }> };
  };
}

function readText(
  row: RestockRequestRow,
  property: typeof NOTIFY_ITEM_PROPERTY | typeof NOTIFY_SIZE_PROPERTY,
): string {
  return (row.properties?.[property]?.rich_text ?? [])
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

/**
 * Every back-in-stock request in the inbox — the rows whose `Request type` is
 * "Back in stock". Rows with no email or no item are skipped (there is nobody to
 * alert, or nothing to match them against). Returns `[]` — never throws — when
 * the contact database is unconfigured.
 *
 * Whether a request has already been answered is NOT decided here; the caller
 * claims each one in Postgres, which is what makes a re-run idempotent.
 */
export async function findPendingBackInStockRequests(
  client: NotionClient = getContactNotionClient(),
): Promise<PendingRestockRequest[]> {
  if (!client.databaseId) {
    return [];
  }

  const rows = await scanDatabase<RestockRequestRow>(
    client,
    "back-in-stock requests",
    {
      filter: {
        property: NOTIFY_TYPE_PROPERTY,
        select: { equals: NOTIFY_REQUEST_TYPE },
      },
    },
  );

  const requests: PendingRestockRequest[] = [];
  for (const row of rows) {
    const email = row.properties?.[CONTACT_EMAIL_PROPERTY]?.email ?? "";
    const item = readText(row, NOTIFY_ITEM_PROPERTY);
    if (!email || !item) continue;
    requests.push({
      pageId: row.id,
      email,
      item,
      size: readText(row, NOTIFY_SIZE_PROPERTY),
    });
  }
  return requests;
}
