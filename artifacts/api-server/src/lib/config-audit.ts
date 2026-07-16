// Guards against silent drift between code constants that NAME specific Notion
// option values and the live options the atelier edits freely in Notion.
//
// Several features hinge on a hardcoded option *value* — the shop's size chart
// (SIZED_CATEGORIES), the sellable status (STATUS_IN_STOCK), the measurement
// lock stage (MEASUREMENT_LOCK_FROM_STAGE). These are deliberate exceptions to
// the "never hardcode a Notion option list" rule (see CLAUDE.md), but they share
// a failure mode: when someone renames or removes that option in Notion (e.g.
// "Dresses" → "Dress"), the frozen name stops matching and the feature quietly
// breaks — with no error, no test failure, nothing. That is exactly the
// size-chart bug this module is meant to make loud.
//
// The audit is ADVISORY: it computes what's missing and callers log it. It never
// throws and never changes behaviour. The durable fix is to make these decisions
// Notion-driven data (see the size-chart / Categories DB plan) so there is no
// hardcoded name left to drift.

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
