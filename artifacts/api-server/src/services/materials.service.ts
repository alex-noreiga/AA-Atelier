// The materials restock alerts, HTTP-agnostic.
//
// The atelier's materials inventory has carried reorder points, a stock-on-hand
// formula and a restock-alert formula since long before the app existed — and
// the app had never read the database, so the alerts sat in a Notion view nobody
// opens mid-project. This is the read that puts them where the rest of the
// studio work happens.
//
// Three decisions this owns beyond "call Notion":
//
//  1. **The trip is re-derived here, not read off the atelier's formula.** The
//     rule is the plain one the formula encodes — at or below the reorder point
//     — but computing it gives a typed `shortfall` the panel ranks by ("order
//     this first"), and it can't break when the formula's wording changes. The
//     cost is a duplicated rule: change what counts as low in Notion and it must
//     change here too. Named the same way `STATUS_IN_STOCK` is.
//  2. **Unknown stock is never an alert.** `Stock on Hand` is a formula over two
//     rollups and can be genuinely absent on a material with no intake lines.
//     Absent is not zero — "we have none" and "we have never counted" are
//     different claims — so an unknown-stock row is reported as untracked (it
//     needs setting up) rather than shouted about as if it had run out.
//  3. **A muted material is silent, and only counted.** The suppression checkbox
//     is the atelier saying "don't tell me about this one" (see the schema's
//     trap 1), so those rows are in neither list. The count is still reported, so
//     the panel can say how many are muted rather than the number silently not
//     adding up.

import {
  listMaterials,
  materialsConfigured,
} from "../lib/notion/materials.repository.js";
import { isNotionNotFound } from "../lib/notion/errors.js";
import type { MaterialRecord } from "../lib/notion/materials.schema.js";
import { logger } from "../lib/logger.js";

/** A material at or below its reorder point — something to buy. */
export interface MaterialAlert {
  id: string;
  name: string;
  category?: string;
  /** The fabric(s) it is, when tagged — what the dashboard sub-groups fabric by
   * so a reorder list reads as "two power meshes and a satin" rather than as
   * one undifferentiated run of fabric. */
  fabricTypes?: string[];
  /** Units remaining. Always a number here: unknown stock is never an alert. */
  stockOnHand: number;
  /** The reorder point it fell to or below. */
  minimumStock: number;
  /** How far under the reorder point it is; `0` when it has landed exactly on it. */
  shortfall: number;
  link?: string;
  pricePerUnit?: number;
}

/** A material no alert can ever fire for, and why — the panel's "not watched"
 * list, so the gap is visible instead of the alerts just looking quiet. */
export interface UntrackedMaterial {
  id: string;
  name: string;
  category?: string;
  fabricTypes?: string[];
  /** `"no-reorder-point"` when `Minimum Stock` is unset, `"stock-unknown"` when
   * the stock formula produced no number. */
  reason: "no-reorder-point" | "stock-unknown";
  /** Present only for `"no-reorder-point"`, where the stock IS known. */
  stockOnHand?: number;
}

export interface MaterialsOverview {
  /** At or below the reorder point, worst shortfall first. */
  lowStock: MaterialAlert[];
  /** Not watched, and why — alphabetical. */
  untracked: UntrackedMaterial[];
  /** How many materials the atelier has deliberately muted. */
  suppressedCount: number;
  /** Every material row read, muted ones included. */
  totalCount: number;
  /** False when `NOTION_MATERIALS_DATABASE_ID` is unset — the panel says so
   * rather than rendering an empty list that looks like "all good". */
  configured: boolean;
  /** True when the id IS set but Notion answered 404 — the integration has not
   * been shared with the database, or the id is wrong. Configured-but-unreadable
   * is a third state, and it is a configuration one: see
   * {@link getMaterialsOverview}. Absent when the read worked. */
  unreachable?: boolean;
}

/**
 * Split materials into what needs buying and what isn't being watched. Pure, so
 * the rule is testable without Notion — and shared by the dashboard panel and
 * the weekly digest, which must not disagree about what "low" means.
 */
export function classifyMaterials(
  materials: MaterialRecord[],
): Omit<MaterialsOverview, "configured"> {
  const lowStock: MaterialAlert[] = [];
  const untracked: UntrackedMaterial[] = [];
  let suppressedCount = 0;

  for (const material of materials) {
    if (material.alertsSuppressed) {
      suppressedCount += 1;
      continue;
    }

    const { stockOnHand, minimumStock } = material;

    if (minimumStock === null) {
      untracked.push({
        id: material.id,
        name: material.name,
        reason: "no-reorder-point",
        ...(material.category ? { category: material.category } : {}),
        ...(material.fabricTypes ? { fabricTypes: material.fabricTypes } : {}),
        ...(stockOnHand !== null ? { stockOnHand } : {}),
      });
      continue;
    }

    if (stockOnHand === null) {
      untracked.push({
        id: material.id,
        name: material.name,
        reason: "stock-unknown",
        ...(material.category ? { category: material.category } : {}),
        ...(material.fabricTypes ? { fabricTypes: material.fabricTypes } : {}),
      });
      continue;
    }

    // The rule: at or below the reorder point. "At" counts — a reorder point is
    // the level you buy AT, not one you wait to fall under.
    if (stockOnHand <= minimumStock) {
      lowStock.push({
        id: material.id,
        name: material.name,
        stockOnHand,
        minimumStock,
        shortfall: round2(minimumStock - stockOnHand),
        ...(material.category ? { category: material.category } : {}),
        ...(material.fabricTypes ? { fabricTypes: material.fabricTypes } : {}),
        ...(material.link ? { link: material.link } : {}),
        ...(material.pricePerUnit !== undefined
          ? { pricePerUnit: material.pricePerUnit }
          : {}),
      });
    }
  }

  // Worst shortfall first — what to buy first. Ties break by name so the order
  // is stable between loads rather than following Notion's cursor.
  lowStock.sort((a, b) => b.shortfall - a.shortfall || cmp(a.name, b.name));
  untracked.sort((a, b) => cmp(a.name, b.name));

  return {
    lowStock,
    untracked,
    suppressedCount,
    totalCount: materials.length,
  };
}

/** Fractional yardages make `1.5 - 0.7` a floating-point mess; a shortfall is
 * shown to the atelier, not used in further arithmetic. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function cmp(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * The dashboard's materials panel. Degrades to an empty, `configured: false`
 * overview when the database isn't wired up — a marketing-page-style refusal to
 * 500 over a missing id, and the panel renders the reason.
 *
 * A Notion **404** degrades the same way, with `unreachable` marking it. An id
 * that is set but that the integration can't see (never shared, or the wrong id
 * pasted in) is the same KIND of state as an unset one — a configuration
 * mistake only a human can clear — and it behaved like the opposite: every
 * dashboard load 500'd the panel and emailed the alert inbox, saying only
 * "Notion query failed with status 404". So it's reported to the panel, which
 * says what to fix, and the error message now names the database either way.
 *
 * Every other failure still throws. A 502 from Notion IS an outage, it clears
 * on its own, and it is worth exactly the one alert the error handler sends.
 */
export async function getMaterialsOverview(): Promise<MaterialsOverview> {
  const empty = {
    lowStock: [],
    untracked: [],
    suppressedCount: 0,
    totalCount: 0,
  } satisfies Omit<MaterialsOverview, "configured">;

  if (!materialsConfigured()) {
    return { ...empty, configured: false };
  }

  try {
    const materials = await listMaterials();
    return { ...classifyMaterials(materials), configured: true };
  } catch (err) {
    if (!isNotionNotFound(err)) throw err;
    logger.warn(
      { err },
      "Materials database is configured but Notion cannot see it; check the id and that the integration is shared with it",
    );
    return { ...empty, configured: true, unreachable: true };
  }
}
