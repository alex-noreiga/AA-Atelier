// Review persistence against the dedicated "Reviews" Notion database. Unlike
// the contact-inbox writers, reviews have their own database, so this reads
// `NOTION_REVIEWS_DATABASE_ID` (via `getReviewsNotionClient`) rather than
// reusing the contact client.

import { getReviewsNotionClient, type NotionClient } from "./client.js";
import {
  buildReviewProperties,
  buildReviewPageBlocks,
  type ReviewRow,
} from "./reviews.blocks.js";

function assertConfigured(client: NotionClient): void {
  if (!client.databaseId) {
    throw new Error(
      "NOTION_REVIEWS_DATABASE_ID is not configured for the reviews database",
    );
  }
}

export async function createReview(
  row: ReviewRow,
  client: NotionClient = getReviewsNotionClient(),
  clientPageId?: string,
): Promise<void> {
  assertConfigured(client);

  const body: Record<string, unknown> = {
    parent: { database_id: client.databaseId },
    properties: buildReviewProperties(row, clientPageId),
    children: buildReviewPageBlocks(row),
  };

  const response = await client.fetch("/v1/pages", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion review creation failed with status ${response.status}: ${errorText}`,
    );
  }
}
