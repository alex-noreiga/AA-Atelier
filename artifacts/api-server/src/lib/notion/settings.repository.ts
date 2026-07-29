// Reads the optional "Studio Settings" Notion database into a key→value map,
// with the same 60s TTL in-memory cache + fallback pattern as
// `fetchLiveOrderStages` / `listCategoryRecords`. This is the live-config source
// the atelier edits in Notion instead of Vercel (see the "Studio Settings" note
// in CLAUDE.md).
//
// Two load-bearing behaviours, both the codebase's degrade-gracefully contract:
//   1. Self-gate: unset `NOTION_SETTINGS_DATABASE_ID` ⇒ an empty map, so every
//      setting falls back to its env var / built-in default (same as the optional
//      CRM / product-categories integrations).
//   2. Never throw: a fetch failure returns the last-good cache, or an empty map
//      if there is none — a settings hiccup must never take down a request, since
//      the env-var fallback keeps every consumer working.

import { getSettingsNotionClient, type NotionClient } from "./client.js";
import { extractSettings, type NotionSettingsPage } from "./settings.schema.js";

const SETTINGS_CACHE_TTL_MS = 60_000;

let cachedSettings: {
  settings: Map<string, string>;
  fetchedAt: number;
} | null = null;

/**
 * The live studio settings as a key→value map. Empty when the database is
 * unconfigured or a first fetch fails; served from a 60s cache otherwise.
 */
export async function fetchStudioSettings(
  client: NotionClient = getSettingsNotionClient(),
): Promise<Map<string, string>> {
  // Unconfigured — no settings database — so nothing overrides env/defaults.
  if (!client.databaseId) {
    return new Map();
  }

  if (
    cachedSettings &&
    Date.now() - cachedSettings.fetchedAt < SETTINGS_CACHE_TTL_MS
  ) {
    return cachedSettings.settings;
  }

  let response: Response;
  try {
    response = await client.fetch(`/v1/databases/${client.databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100 }),
    });
  } catch {
    // Network error — serve stale if we have it, else degrade to env/defaults.
    return cachedSettings?.settings ?? new Map();
  }

  if (!response.ok) {
    return cachedSettings?.settings ?? new Map();
  }

  const data = (await response.json()) as { results: NotionSettingsPage[] };
  const settings = extractSettings(data.results ?? []);
  cachedSettings = { settings, fetchedAt: Date.now() };
  return settings;
}

/** Test seam: drop the module cache so a case starts from a clean fetch. */
export function __resetSettingsCache(): void {
  cachedSettings = null;
}
