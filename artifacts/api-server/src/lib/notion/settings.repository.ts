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

import {
  getSettingsNotionClient,
  assertDatabaseConfigured,
  type NotionClient,
} from "./client.js";
import {
  extractSettings,
  extractSettingRows,
  SETTING_KEY_PROPERTY,
  SETTING_VALUE_PROPERTY,
  SETTING_DESCRIPTION_PROPERTY,
  type NotionSettingsPage,
  type SettingRow,
} from "./settings.schema.js";
import { logger } from "../logger.js";

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

/** Whether the settings database is wired up at all. Unset ⇒ every setting is
 * env/default-only and the dashboard's editor is read-only rather than offering
 * a Save that has nowhere to write. */
export function settingsConfigured(
  client: NotionClient = getSettingsNotionClient(),
): boolean {
  return Boolean(client.databaseId);
}

/**
 * EVERY row in the settings database, page ids included — the read behind the
 * dashboard's editor.
 *
 * Deliberately not the cached map above. That map is keyed by setting name, so
 * a row whose key is mistyped simply isn't in it, and a duplicate row loses to
 * whichever came last; both are states the editor exists to make visible. This
 * read is also uncached, because it is what the atelier looks at immediately
 * after saving — a 60s-stale answer there reads as the save having failed.
 * Unlike `fetchStudioSettings` it THROWS on failure: the map has an
 * env-fallback behind it, an editor showing an empty list would just be lying.
 */
export async function fetchSettingRows(
  client: NotionClient = getSettingsNotionClient(),
): Promise<SettingRow[]> {
  if (!client.databaseId) return [];

  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    { method: "POST", body: JSON.stringify({ page_size: 100 }) },
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion settings query failed with status ${response.status}: ${errorText}`,
    );
  }
  const data = (await response.json()) as { results: NotionSettingsPage[] };
  return extractSettingRows(data.results ?? []);
}

/**
 * Write one setting's value, updating the row that already holds the key or
 * creating it when there isn't one. An empty `value` is a legitimate write: a
 * blank Value reads as unset everywhere, so clearing the field is how a setting
 * is handed back to its env var / built-in default, and it keeps the row (which
 * documents the key) rather than deleting it.
 *
 * The cached map is dropped afterwards so the next request's `primeSettings`
 * sees the change immediately — a saved setting that takes up to a minute to
 * take effect reads as a save that didn't work. Per-instance, like every other
 * cache here.
 */
export async function saveSetting(
  key: string,
  value: string,
  description: string | undefined,
  client: NotionClient = getSettingsNotionClient(),
): Promise<void> {
  assertDatabaseConfigured(
    client,
    "NOTION_SETTINGS_DATABASE_ID is not set, so there is no settings database to write to.",
  );

  const rows = await fetchSettingRows(client);
  // The LAST row wins, matching `extractSettings` — on the duplicate rows a
  // hand-edited database can hold, writing to the first one would be a save that
  // reports success and changes nothing the app reads, which is the exact class
  // of silent failure this editor exists to end.
  const existing = rows.filter((row) => row.key === key).pop();
  const valueProperty = {
    [SETTING_VALUE_PROPERTY]: {
      rich_text: value ? [{ text: { content: value } }] : [],
    },
  };

  const response = existing
    ? await client.fetch(`/v1/pages/${existing.pageId}`, {
        method: "PATCH",
        body: JSON.stringify({ properties: valueProperty }),
      })
    : await createSettingRow(client, key, valueProperty, description);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion settings write failed with status ${response.status}: ${errorText}`,
    );
  }

  cachedSettings = null;
}

/**
 * Create the row for a key the database doesn't have yet, seeding the human
 * `Description` from the catalog so a row the dashboard made reads the same as
 * one the atelier wrote by hand.
 *
 * `Description` is the one property here the setup instructions call optional,
 * and Notion rejects the WHOLE create when a page names a property the database
 * lacks — so a database without that column would otherwise be unable to save
 * any setting at all. One bounded retry without it, with a pointed warn, is the
 * same degrade-don't-fail contract `createPageDroppingUnknownProperties` gives
 * the order intake.
 */
async function createSettingRow(
  client: NotionClient,
  key: string,
  valueProperty: Record<string, unknown>,
  description: string | undefined,
): Promise<Response> {
  const title = {
    [SETTING_KEY_PROPERTY]: { title: [{ text: { content: key } }] },
  };
  const create = (properties: Record<string, unknown>) =>
    client.fetch("/v1/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { database_id: client.databaseId },
        properties,
      }),
    });

  if (!description) return create({ ...title, ...valueProperty });

  const response = await create({
    ...title,
    ...valueProperty,
    [SETTING_DESCRIPTION_PROPERTY]: {
      rich_text: [{ text: { content: description } }],
    },
  });
  if (response.ok || response.status !== 400) return response;

  logger.warn(
    { property: SETTING_DESCRIPTION_PROPERTY },
    "The Studio Settings database has no Description property; saving the setting without it. Add the property in Notion to keep the rows self-documenting.",
  );
  return create({ ...title, ...valueProperty });
}
