// Schema mapping for the optional "Studio Settings" Notion database — a simple
// key/value store the atelier edits in Notion to retune the app's runtime
// business rules (rush rate, measurement-lock stage, appointment policy, the
// notification inboxes) WITHOUT touching Vercel or redeploying. It only ever
// holds non-secret tunables; secrets and database ids stay in the environment
// (see the "Studio Settings" note in CLAUDE.md).
//
// A row is one setting: a `Setting` title (the key, matching the env var name so
// the mapping can't drift), a `Value` text (the value), and a `Description` text
// (a human note the app never reads). Unknown rows are ignored; a missing row
// falls back to that setting's env var / built-in default.

export const SETTING_KEY_PROPERTY = "Setting"; // title — the setting key
export const SETTING_VALUE_PROPERTY = "Value"; // rich_text — the setting value
// rich_text — a human note the app never READS, but does seed when the dashboard
// creates a row, so a key added from the editor documents itself in Notion.
export const SETTING_DESCRIPTION_PROPERTY = "Description";

export interface NotionSettingsPage {
  id?: string;
  properties: {
    Setting?: { type: "title"; title: Array<{ plain_text: string }> };
    Value?: { type: "rich_text"; rich_text: Array<{ plain_text: string }> };
  };
}

function titleText(page: NotionSettingsPage): string {
  return (
    page.properties[SETTING_KEY_PROPERTY]?.title
      ?.map((t) => t.plain_text)
      .join("")
      .trim() ?? ""
  );
}

function valueText(page: NotionSettingsPage): string {
  return (
    page.properties[SETTING_VALUE_PROPERTY]?.rich_text
      ?.map((t) => t.plain_text)
      .join("")
      .trim() ?? ""
  );
}

/** Build the key→value map from the Settings database rows. Rows with an empty
 * key are skipped; on a duplicate key the last row wins. */
export function extractSettings(
  pages: NotionSettingsPage[],
): Map<string, string> {
  const settings = new Map<string, string>();
  for (const page of pages) {
    const key = titleText(page);
    if (!key) continue;
    settings.set(key, valueText(page));
  }
  return settings;
}

/** One settings row as the dashboard sees it: the Notion page id (so a value can
 * be written back to the row that already exists rather than a second one), the
 * key as typed, and the value. Unlike the map above this keeps EVERY row —
 * including one whose key isn't a setting the app reads, which is the whole
 * point: a mistyped key is invisible in the map and is exactly what the editor
 * has to be able to show. */
export interface SettingRow {
  pageId: string;
  key: string;
  value: string;
}

/** Every row in the settings database, in Notion's order. Rows with a blank key
 * are skipped — there is nothing to show and nothing to match. */
export function extractSettingRows(pages: NotionSettingsPage[]): SettingRow[] {
  const rows: SettingRow[] = [];
  for (const page of pages) {
    const key = titleText(page);
    if (!key) continue;
    rows.push({ pageId: page.id ?? "", key, value: valueText(page) });
  }
  return rows;
}
