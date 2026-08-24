// Data-deletion (erasure) request persistence. Shares the "Website Contact
// Messages" database with the seven other request writers — same inbox,
// distinguished by `Request type` — so it reuses the contact client and needs no
// database id of its own. The write path is the shared `contactDatabaseWriter`.
//
// The one addition is the read below. Erasure is the request a worried customer
// presses twice, and unlike a cancellation there is no order to hang the second
// press on: two identical rows in the inbox is noise on exactly the request
// where the studio most needs one clear item of work. So the service asks first
// whether one is already open, and files nothing when it is.

import {
  getContactNotionClient,
  assertDatabaseConfigured,
  type NotionClient,
} from "./client.js";
import { contactDatabaseWriter } from "./contact-writer.js";
import {
  buildDataDeletionProperties,
  DATA_DELETION_REQUEST_TYPE,
  type DataDeletionRow,
} from "./data-deletion.blocks.js";
import {
  CONTACT_EMAIL_PROPERTY,
  CONTACT_STAGE_PROPERTY,
  CONTACT_TYPE_PROPERTY,
} from "./contact.blocks.js";
import { REQUEST_STAGE_CLOSED } from "./requests.schema.js";
import { normalizeEmail } from "../email.js";

export const createDataDeletionRequest = contactDatabaseWriter<DataDeletionRow>(
  buildDataDeletionProperties,
  "data deletion request",
);

interface NotionQueryResults {
  results: Array<{ id: string }>;
}

/**
 * Whether this customer already has an erasure request the atelier hasn't
 * closed.
 *
 * `Stage != Closed` rather than `Stage in (New, Replied)`, matching the queue's
 * own open filter — Notion's `does_not_equal` also matches an empty select, so a
 * row someone edited into an unrecognized stage still counts as open. Erring
 * that way means a second press reports "already on file"; erring the other way
 * would file a duplicate, and of the two, a request the customer thinks is new
 * when it is already open is the harmless one.
 */
export async function hasOpenDataDeletionRequest(
  email: string,
  client: NotionClient = getContactNotionClient(),
): Promise<boolean> {
  assertDatabaseConfigured(
    client,
    "NOTION_CONTACT_DATABASE_ID is not configured for the contact database",
  );

  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        page_size: 1,
        filter: {
          and: [
            {
              property: CONTACT_TYPE_PROPERTY,
              select: { equals: DATA_DELETION_REQUEST_TYPE },
            },
            {
              property: CONTACT_EMAIL_PROPERTY,
              email: { equals: normalized },
            },
            {
              property: CONTACT_STAGE_PROPERTY,
              select: { does_not_equal: REQUEST_STAGE_CLOSED },
            },
          ],
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Notion data deletion request lookup failed with status ${response.status}`,
    );
  }

  const data = (await response.json()) as NotionQueryResults;
  return data.results.length > 0;
}
