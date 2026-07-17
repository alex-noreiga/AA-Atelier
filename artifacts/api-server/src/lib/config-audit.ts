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
 * This is the server-side FALLBACK list used by `products.service` only when the
 * Notion "Product Categories" DB is unconfigured (see Option C phase 1) — the
 * frontend `SIZED_CATEGORIES` list that this used to mirror was removed when the
 * shop switched to the Notion-driven `product.sized` flag. It must match the
 * canonical inventory "Item Type" option values ("Dress", not "Dresses"). Both
 * this and the guard disappear at Option C phase 2, when Item Type becomes a
 * relation and no hardcoded name is left to drift.
 */
export const SIZED_CATEGORY_NAMES = ["Dress", "Ready to Wear"];

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

/** One code constant (or set of them) whose named Notion values have drifted. */
export interface ConfigDriftFinding {
  /** Human-readable label for the feature / constant being checked. */
  label: string;
  /** The named values that no longer exist among the live Notion options. */
  missing: string[];
}

/** The live Notion option lists + the code constants to check them against. */
export interface ConfigAuditInput {
  itemTypeOptions: string[];
  statusOptions: string[];
  stageOptions: string[];
  /** The sellable status value (products.schema `STATUS_IN_STOCK`). */
  statusInStock: string;
  /** The measurement production-lock stage (measurement-lock `lockFromStage()`). */
  measurementLockStage: string;
}

/**
 * Check every code constant that NAMES a live Notion option value against the
 * current options, returning one finding per constant whose value has gone
 * missing (a Notion rename/removal that will silently break that feature). Pure,
 * so the nightly config-check cron can log + email from the result.
 */
export function auditNotionConfig(
  input: ConfigAuditInput,
): ConfigDriftFinding[] {
  const findings: ConfigDriftFinding[] = [];
  const check = (label: string, expected: string[], live: string[]): void => {
    const missing = missingOptionValues(expected, live);
    if (missing.length > 0) findings.push({ label, missing });
  };

  check(
    'Size-chart categories (shop "Item Type")',
    SIZED_CATEGORY_NAMES,
    input.itemTypeOptions,
  );
  check(
    "Sellable status (STATUS_IN_STOCK)",
    [input.statusInStock],
    input.statusOptions,
  );
  check(
    "Measurement-lock stage (MEASUREMENT_LOCK_FROM_STAGE)",
    [input.measurementLockStage],
    input.stageOptions,
  );

  return findings;
}
