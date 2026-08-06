// The intake color palette — the flat list of colors the custom-order form's
// picker offers. Unlike the shop's live Notion databases, this is a small,
// rarely-changed list, so it lives as ONE atelier-editable "Studio Settings" row
// (`COLOR_PALETTE`) rather than its own database: `settingValue(...) ??
// process.env.COLOR_PALETTE ?? DEFAULT_PRIMARY_PALETTE`, the same Notion → env →
// default resolution as `rushSurchargeRate()` / the appointment settings.
//
// The value is a human-editable string of `Name #hex` entries separated by
// commas, e.g. "Emerald #0B6E4F, Rose Gold #C5878C, Navy #1F2A44". A built-in
// primary palette ships in code, so the picker works with zero setup; the row is
// only needed to customize it. Sync + pure over the primed settings snapshot, so
// it's unit-testable and reads the live override per request (the prime
// middleware refreshes the snapshot before the route runs).

import { settingValue } from "../lib/settings/store.js";

/** One selectable color chip, matching the contract `Color` shape. */
export interface Color {
  /** A stable slug of the name ("Rose Gold" → "rose-gold"), used as the id. */
  id: string;
  name: string;
  /** Hex fill for the chip, e.g. "#2E5CB8" (always present). */
  hex: string;
}

/** A color name → a stable slug ("Rose Gold" → "rose-gold"). Mirrors the slug in
 * the frontend `color-picker.tsx` so ids/testids line up. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The built-in primary palette, used when `COLOR_PALETTE` isn't configured. A
 * default with a Studio-Settings override (not a hardcoded authoritative list),
 * so the atelier can replace it wholesale without a redeploy. */
const DEFAULT_PRIMARY_PALETTE: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "Red", hex: "#C0392B" },
  { name: "Orange", hex: "#E67E22" },
  { name: "Yellow", hex: "#F1C40F" },
  { name: "Green", hex: "#27AE60" },
  { name: "Blue", hex: "#2E5CB8" },
  { name: "Purple", hex: "#7A3E9D" },
  { name: "Pink", hex: "#E48AA8" },
  { name: "Black", hex: "#1A1A1A" },
  { name: "White", hex: "#FFFFFF" },
  { name: "Ivory", hex: "#F3ECE2" },
  { name: "Gold", hex: "#C7A75E" },
  { name: "Silver", hex: "#C0C4CC" },
];

/** A 3- or 6-digit hex color, with the leading `#`. */
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Parse a `COLOR_PALETTE` string into color chips. Each comma-separated entry is
 * `Name #hex` — the trailing token is the hex, everything before it is the name
 * (so multi-word names like "Rose Gold" work). Entries with a missing/invalid
 * hex or blank name are skipped, and later duplicates (by slug) are dropped, so a
 * mis-typed value degrades gracefully rather than breaking the picker. Returns
 * `[]` when nothing valid parses (the caller then falls back to the default).
 */
export function parseColorPalette(raw: string): Color[] {
  const colors: Color[] = [];
  const seen = new Set<string>();
  for (const entry of raw.split(",")) {
    const parts = entry.trim().split(/\s+/);
    const hex = parts.pop() ?? "";
    const name = parts.join(" ").trim();
    if (!name || !HEX_RE.test(hex)) continue;
    const id = slug(name);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    colors.push({ id, name, hex });
  }
  return colors;
}

/** The default palette as contract `Color`s. */
function defaultColors(): Color[] {
  return DEFAULT_PRIMARY_PALETTE.map(({ name, hex }) => ({
    id: slug(name),
    name,
    hex,
  }));
}

/**
 * The intake color palette: the parsed `COLOR_PALETTE` Studio Settings row (or
 * the env var of the same name), falling back to the built-in primary palette
 * when unset, empty, or entirely unparseable. Sync — reads the primed settings
 * snapshot at call time, like `rushSurchargeRate()`.
 */
export function intakeColorPalette(): Color[] {
  const raw = settingValue("COLOR_PALETTE") ?? process.env.COLOR_PALETTE;
  if (raw) {
    const parsed = parseColorPalette(raw);
    if (parsed.length > 0) return parsed;
  }
  return defaultColors();
}
