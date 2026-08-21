// The studio dashboard's settings editor, HTTP-agnostic.
//
// The settings database is a free-text key/value table, and both halves of a row
// fail silently when they're wrong. A mistyped KEY is a row nothing reads; a
// mistyped VALUE is parsed, rejected, and quietly replaced by the built-in
// default. Either way Notion shows a row that looks like it is in force. This
// service is the read that ends that: for every key the app knows, what the
// Notion row says, what the environment says, what the built-in default is, and
// — the answer the atelier actually wants — which of the three is in force right
// now and why.
//
// Three rules hold the whole thing together:
//
//  1. **Resolution is mirrored exactly, including the part that surprises
//     people.** Every getter reads `settingValue(KEY) ?? process.env[KEY]` and
//     then parses. So a value present in Notion but unusable falls back to the
//     DEFAULT — it does not fall through to the environment, because the
//     environment was never consulted. Reporting it as "environment" would be
//     wrong in the one case someone is looking this page up to understand.
//  2. **What counts as usable is the runtime's rule** (`accepts`), not the
//     editor's (`validate`). The editor may refuse to SAVE something the runtime
//     would honour; it must never claim the app is ignoring a value the app is
//     in fact using.
//  3. **Unknown rows are reported, not swallowed.** A row whose key isn't a
//     setting is listed with the near-miss it was probably meant to be. This is
//     the only place in the app where such a row is visible at all.

import {
  fetchSettingRows,
  settingsConfigured,
  saveSetting,
} from "../lib/notion/settings.repository.js";
import type { SettingRow } from "../lib/notion/settings.schema.js";
import {
  SETTING_DEFINITIONS,
  settingDefinition,
  type SettingDefinition,
} from "../lib/settings/catalog.js";
import { BadRequestError, ConflictError } from "../lib/errors.js";

/** Where the value the app is currently using came from. */
export type SettingSource = "notion" | "environment" | "default";

export interface StudioSettingView {
  key: string;
  label: string;
  group: string;
  kind: string;
  description: string;
  /** What the Notion row holds, when there is one with a value. */
  notionValue?: string;
  /** What the environment holds, when it's set. */
  envValue?: string;
  /** The built-in fallback as text ("" when the fallback isn't a value). */
  defaultValue: string;
  /** How to phrase the fallback when it isn't simply `defaultValue`. */
  defaultLabel?: string;
  /** The value in force right now. */
  effectiveValue: string;
  source: SettingSource;
  /** Set when a value IS configured but the app can't use it, so the default is
   * in force instead — the silent failure this whole surface exists to show. */
  ignoredValue?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
}

export interface UnknownSettingRow {
  key: string;
  value?: string;
  /** The setting it was probably meant to be, when one is a near miss. */
  suggestion?: string;
}

export interface StudioSettingsOverview {
  /** Whether there's a settings database to write to. False ⇒ every value below
   * comes from the environment or a default, and nothing here can be edited. */
  configured: boolean;
  settings: StudioSettingView[];
  unknownRows: UnknownSettingRow[];
}

/** The environment's value for a key, treating blank as unset — the same way
 * `settingValue` treats a blank Notion cell. */
function envValue(key: string): string | undefined {
  const raw = process.env[key]?.trim();
  return raw ? raw : undefined;
}

/**
 * Resolve one setting the way the runtime does. The order is the getters'
 * order — Notion, then environment — and whichever is found first is the only
 * one considered: if it can't be used, the built-in default takes over rather
 * than the next source down.
 */
export function resolveSetting(
  definition: SettingDefinition,
  notionValue: string | undefined,
  environment: string | undefined,
): StudioSettingView {
  const view: StudioSettingView = {
    key: definition.key,
    label: definition.label,
    group: definition.group,
    kind: definition.kind,
    description: definition.description,
    defaultValue: definition.defaultValue,
    effectiveValue: definition.defaultValue,
    source: "default",
    ...(notionValue ? { notionValue } : {}),
    ...(environment ? { envValue: environment } : {}),
    ...(definition.defaultLabel
      ? { defaultLabel: definition.defaultLabel }
      : {}),
    ...(definition.min !== undefined ? { min: definition.min } : {}),
    ...(definition.max !== undefined ? { max: definition.max } : {}),
    ...(definition.step !== undefined ? { step: definition.step } : {}),
    ...(definition.unit ? { unit: definition.unit } : {}),
    ...(definition.placeholder ? { placeholder: definition.placeholder } : {}),
  };

  const configured = notionValue ?? environment;
  if (configured === undefined) return view;

  if (definition.accepts(configured)) {
    view.effectiveValue = configured;
    view.source = notionValue !== undefined ? "notion" : "environment";
    return view;
  }

  // Configured but unusable: the getter falls back to its built-in default and
  // says nothing. Naming the value that is being thrown away is the point.
  view.ignoredValue = configured;
  return view;
}

/** Is `candidate` a near miss for `key` — within one or two typos, ignoring case
 * and the punctuation someone might use in a Notion title? */
function isNearMiss(candidate: string, key: string): boolean {
  const a = candidate.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const b = key.replace(/[^A-Z0-9]/g, "");
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2) return false;

  // Levenshtein, bounded at 2 — enough for a dropped letter, a doubled one, or
  // a transposition, and short of matching two different settings.
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] <= 2;
}

/** Rows in the database that aren't settings the app reads, each with the key it
 * was probably meant to be. */
export function unknownRows(rows: SettingRow[]): UnknownSettingRow[] {
  const known = new Set(SETTING_DEFINITIONS.map((d) => d.key));
  const unknown: UnknownSettingRow[] = [];
  for (const row of rows) {
    if (known.has(row.key)) continue;
    const suggestion = SETTING_DEFINITIONS.find((d) =>
      isNearMiss(row.key, d.key),
    )?.key;
    unknown.push({
      key: row.key,
      ...(row.value ? { value: row.value } : {}),
      ...(suggestion ? { suggestion } : {}),
    });
  }
  return unknown;
}

/** The value a row holds, treating blank as unset. On duplicate rows for one key
 * the LAST wins, matching `extractSettings`. */
function notionValues(rows: SettingRow[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const row of rows) {
    const value = row.value.trim();
    if (value) values.set(row.key, value);
    else values.delete(row.key);
  }
  return values;
}

/** Every setting, resolved, plus any row that isn't one. */
export async function getStudioSettings(): Promise<StudioSettingsOverview> {
  const configured = settingsConfigured();
  const rows = configured ? await fetchSettingRows() : [];
  const stored = notionValues(rows);

  return {
    configured,
    settings: SETTING_DEFINITIONS.map((definition) =>
      resolveSetting(
        definition,
        stored.get(definition.key),
        envValue(definition.key),
      ),
    ),
    unknownRows: unknownRows(rows),
  };
}

/**
 * Save one setting, or clear it. A blank value is a clear, not a rejection: it's
 * how a setting is handed back to its env var / built-in default, and it's the
 * only "undo" the editor needs.
 *
 * The write is refused outright when the value isn't one the setting can take,
 * which is the difference between this and typing into Notion — there, the same
 * value saves happily and is then ignored forever.
 */
export async function saveStudioSetting(
  key: string,
  rawValue: string,
): Promise<StudioSettingView> {
  const definition = settingDefinition(key);
  if (!definition) {
    throw new BadRequestError(`"${key}" isn't a setting this app reads.`);
  }
  if (!settingsConfigured()) {
    throw new ConflictError(
      "There's no Studio Settings database connected, so these can only be changed in the environment.",
    );
  }

  const value = rawValue.trim();
  if (value) {
    const problem = definition.validate(value);
    if (problem) throw new BadRequestError(problem);
  }

  await saveSetting(key, value, definition.description);

  return resolveSetting(
    definition,
    value || undefined,
    envValue(definition.key),
  );
}
