// Measurement-change request persistence. Like back-in-stock requests, these
// share the "Website Contact Messages" database with contact-form messages —
// same inbox, distinguished by the "Request type" property — so this reuses the
// contact client and needs no database id of its own.

import { getContactNotionClient, type NotionClient } from "./client.js";
import {
  buildMeasurementChangeProperties,
  type MeasurementChangeRow,
} from "./measurement-change.blocks.js";

function assertConfigured(client: NotionClient): void {
  if (!client.databaseId) {
    throw new Error(
      "NOTION_CONTACT_DATABASE_ID is not configured for the contact database",
    );
  }
}

export async function createMeasurementChangeRequest(
  row: MeasurementChangeRow,
  client: NotionClient = getContactNotionClient(),
  clientPageId?: string,
): Promise<void> {
  assertConfigured(client);

  const body: Record<string, unknown> = {
    parent: { database_id: client.databaseId },
    properties: buildMeasurementChangeProperties(row, clientPageId),
  };

  const response = await client.fetch("/v1/pages", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion measurement-change request creation failed with status ${response.status}: ${errorText}`,
    );
  }
}
