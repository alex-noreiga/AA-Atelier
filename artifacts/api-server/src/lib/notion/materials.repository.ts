// Reads for the Notion "materials inventory" database.
//
// Like the studio analytics, this has nothing to filter by: the dashboard
// panel and the weekly digest both want the whole book of materials, so it is a
// bounded full-database scan through the shared `scanDatabase`.
//
// WHY IT DOESN'T FILTER ON THE `Restock Alert` FORMULA. The database carries the
// atelier's own `Restock Alert` formula, and asking Notion for "just the rows
// where it trips" would be the obvious read. Two reasons it isn't:
//
//   * A `formula: {…}` FILTER on a formula derived from rollups 400s through the
//     API ("Unable to filter based on a formula of unknown type") — the same
//     wall the Production Schedule's `Milestone Status` hit, which is why that
//     one is evaluated per row client-side too. See
//     `.agents/memory/phase2-workspace-cards.md`.
//   * The formula's RESULT is a display value the atelier can restyle at will,
//     so matching on it would be a string compare against wording nobody
//     promised to keep. The service re-derives the trip from the two numbers
//     instead (`Stock on Hand` vs `Minimum Stock`), which also yields the
//     shortfall the panel ranks by.
//
// Cached for 60s with fall-back-to-stale-on-error, the same contract as every
// other live Notion read here: the atelier edits stock rarely but the panel and
// the digest both read it, and a Notion blip should degrade to slightly stale
// numbers rather than an empty shopping list.

import {
  getMaterialsNotionClient,
  assertDatabaseConfigured,
  type NotionClient,
} from "./client.js";
import { scanDatabase } from "./scan.js";
import {
  extractMaterial,
  type MaterialRecord,
  type NotionMaterialPage,
} from "./materials.schema.js";

const CACHE_TTL_MS = 60_000;
let cached: { materials: MaterialRecord[]; fetchedAt: number } | null = null;

function assertConfigured(client: NotionClient): void {
  assertDatabaseConfigured(
    client,
    "NOTION_MATERIALS_DATABASE_ID is not configured for the materials database",
  );
}

/** Whether the materials database is configured. Unset ⇒ the dashboard panel
 * reports it and the weekly digest no-ops, rather than either one erroring. */
export function materialsConfigured(
  client: NotionClient = getMaterialsNotionClient(),
): boolean {
  return Boolean(client.databaseId);
}

/** Test seam: drop the cached scan so a test's fake client is read afresh. */
export function __resetMaterialsCache(): void {
  cached = null;
}

/** Every material row, newest-cursor-order, bounded by {@link scanDatabase}. */
export async function listMaterials(
  client: NotionClient = getMaterialsNotionClient(),
): Promise<MaterialRecord[]> {
  assertConfigured(client);

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.materials;
  }

  try {
    const pages = await scanDatabase<NotionMaterialPage>(
      client,
      "materials inventory",
    );
    const materials = pages.map(extractMaterial);
    cached = { materials, fetchedAt: Date.now() };
    return materials;
  } catch (error) {
    if (cached) return cached.materials;
    throw error;
  }
}
