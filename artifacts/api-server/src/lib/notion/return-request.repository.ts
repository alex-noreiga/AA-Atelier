// Return / exchange request persistence. Like back-in-stock and
// measurement-change requests, these share the "Website Contact Messages"
// database with contact-form messages — same inbox, distinguished by the
// "Request type" property — so this reuses the contact client and needs no
// database id of its own.

import {
  getContactNotionClient,
  assertDatabaseConfigured,
  type NotionClient,
} from "./client.js";
import {
  buildReturnRequestProperties,
  type ReturnRequestRow,
} from "./return-request.blocks.js";

function assertConfigured(client: NotionClient): void {
  assertDatabaseConfigured(
    client,
    "NOTION_CONTACT_DATABASE_ID is not configured for the contact database",
  );
}

export async function createReturnRequest(
  row: ReturnRequestRow,
  client: NotionClient = getContactNotionClient(),
  clientPageId?: string,
): Promise<void> {
  assertConfigured(client);

  const body: Record<string, unknown> = {
    parent: { database_id: client.databaseId },
    properties: buildReturnRequestProperties(row, clientPageId),
  };

  const response = await client.fetch("/v1/pages", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion return request creation failed with status ${response.status}: ${errorText}`,
    );
  }
}
