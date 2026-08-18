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
  type CreateNotifyInput,
} from "./notify.blocks.js";

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
