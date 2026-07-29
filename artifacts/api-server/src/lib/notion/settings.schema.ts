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

export interface NotionSettingsPage {
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
