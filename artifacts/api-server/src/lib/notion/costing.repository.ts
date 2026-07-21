// Read the atelier's costing system by page id, for the invoice generator.
// Traversal is purely by relation ids (order → Costing Items → Material Usage
// Lines), so these fetch pages directly rather than querying — no database-id is
// needed in the URL. Mirrors the injected-client seam of the other repositories
// so it's testable with a fake. The Notion integration must be shared with both
// databases or the page fetch 404s (surfaced as null, then a clear service error).

import {
  getCostingNotionClient,
  getMaterialUsageNotionClient,
  type NotionClient,
} from "./client.js";
import {
  extractCostingItem,
  extractMaterialUsageLine,
  type CostingItemRecord,
  type MaterialUsageLineRecord,
  type NotionCostingPage,
  type NotionMaterialUsagePage,
} from "./costing.schema.js";

function assertConfigured(client: NotionClient, envVar: string): void {
  if (!client.databaseId) {
    throw new Error(`${envVar} is not configured for the costing databases`);
  }
}

/**
 * Read one costing item by its Notion page id (an order's `Costing Items`
 * relation). Returns null when the page is gone (e.g. a dangling relation), so
 * the caller can skip it rather than fail the whole invoice.
 */
export async function getCostingItem(
  pageId: string,
  client: NotionClient = getCostingNotionClient(),
): Promise<CostingItemRecord | null> {
  assertConfigured(client, "NOTION_COSTING_DATABASE_ID");

  const response = await client.fetch(`/v1/pages/${pageId}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Notion costing fetch failed with status ${response.status}`,
    );
  }

  const page = (await response.json()) as NotionCostingPage;
  return extractCostingItem(page);
}

/**
 * Read one material usage line by its Notion page id (a costing item's
 * `Material Usage Lines` relation). Returns null when the page is gone.
 */
export async function getMaterialUsageLine(
  pageId: string,
  client: NotionClient = getMaterialUsageNotionClient(),
): Promise<MaterialUsageLineRecord | null> {
  assertConfigured(client, "NOTION_MATERIAL_USAGE_DATABASE_ID");

  const response = await client.fetch(`/v1/pages/${pageId}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Notion material usage fetch failed with status ${response.status}`,
    );
  }

  const page = (await response.json()) as NotionMaterialUsagePage;
  return extractMaterialUsageLine(page);
}
