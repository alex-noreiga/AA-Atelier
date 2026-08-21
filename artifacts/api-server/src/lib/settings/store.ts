// The in-process snapshot of the live "Studio Settings" (see
// `../notion/settings.repository.ts`), plus the two accessors the rest of the
// app uses.
//
// Why a primed snapshot: the config getters that read settings
// (`rushSurchargeRate`, `lockFromStage`, the appointment settings, the atelier
// inboxes) are SYNC and read at call time. Notion I/O is async, so we refresh a
// snapshot once at the start of each request (the prime middleware in `app.ts`)
// and the getters read it synchronously — falling back to their env var / default
// when a key is absent. Until `primeSettings` runs (in tests, or before the first
// request) the snapshot is empty, so everything falls back to env exactly as it
// did before this existed: fully backward-compatible.

import { fetchStudioSettings } from "../notion/settings.repository.js";

// The keys the app reads, what each one means, and how a value is validated all
// live in `./catalog.ts` — one entry per setting, which is what the studio
// dashboard's settings editor renders. `settingValue` below still accepts any
// string, so a caller adding a key is never blocked on the catalog; but a key
// missing from it is a key the atelier can't see or edit, so add both together.

let snapshot = new Map<string, string>();

/** Refresh the settings snapshot from Notion (60s-cached, best-effort). Called by
 * the prime middleware at the start of each request. */
export async function primeSettings(): Promise<void> {
  snapshot = await fetchStudioSettings();
}

/**
 * The live value for a setting key, or `undefined` when it isn't set (so callers
 * can `?? process.env.X ?? default`). Empty/whitespace values read as unset.
 */
export function settingValue(key: string): string | undefined {
  const value = snapshot.get(key)?.trim();
  return value ? value : undefined;
}

/** Test seam: set the snapshot directly, bypassing Notion. */
export function __setSettingsSnapshot(entries: Record<string, string>): void {
  snapshot = new Map(Object.entries(entries));
}

/** Test seam: clear the snapshot so getters fall back to env/defaults. */
export function __resetSettings(): void {
  snapshot = new Map();
}
