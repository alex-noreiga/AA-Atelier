// Contact-message persistence against the separate "Website Contact Messages"
// Notion database. Mirrors the orders repository create path, minus the
// order-number generation and stage cache.

import { getContactNotionClient, type NotionClient } from "./client.js";
import {
  buildContactProperties,
  type CreateContactInput,
} from "./contact.blocks.js";

function assertConfigured(client: NotionClient): void {
  if (!client.databaseId) {
    throw new Error(
      "NOTION_CONTACT_DATABASE_ID is not configured for the contact database",
    );
  }
}

export async function createContactMessage(
  data: CreateContactInput,
  client: NotionClient = getContactNotionClient(),
): Promise<void> {
  assertConfigured(client);

  const body: Record<string, unknown> = {
    parent: { database_id: client.databaseId },
    properties: buildContactProperties(data),
  };

  const response = await client.fetch("/v1/pages", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion contact-message creation failed with status ${response.status}: ${errorText}`,
    );
  }
}
