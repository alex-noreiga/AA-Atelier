// Helpers for code constants that NAME specific Notion option values (the
// shop's size chart via SIZED_CATEGORIES, etc.) — deliberate exceptions to the
// "never hardcode a Notion option list" rule (see CLAUDE.md).

/**
 * Values that must exist among the live inventory "Item Type" select options for
 * the shop's size chart to keep appearing on garments.
 *
 * ⚠ Mirrors `SIZED_CATEGORIES` in `artifacts/web-app/src/pages/shop.tsx`. Keep
 * the two in sync until that frontend list is replaced by a Notion-driven
 * "sized" flag, at which point both disappear.
 */
export const SIZED_CATEGORY_NAMES = ["Dress", "Dresses", "Ready to Wear"];

/**
 * The `expected` values that are NOT present in `live`, in the order they were
 * given. Comparison is case-sensitive, matching Notion's option identity (a
 * rename to a different case is real drift). A non-empty result means a code
 * constant names an option that no longer exists in Notion.
 */
export function missingOptionValues(
  expected: readonly string[],
  live: readonly string[],
): string[] {
  const present = new Set(live);
  return expected.filter((value) => !present.has(value));
}
