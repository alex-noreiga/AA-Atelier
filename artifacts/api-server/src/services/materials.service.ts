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
import type { MaterialRecord } from "../lib/notion/materials.schema.js";

/** A material at or below its reorder point — something to buy. */
export interface MaterialAlert {
  id: string;
  name: string;
  category?: string;
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
 */
export async function getMaterialsOverview(): Promise<MaterialsOverview> {
  if (!materialsConfigured()) {
    return {
      lowStock: [],
      untracked: [],
      suppressedCount: 0,
      totalCount: 0,
      configured: false,
    };
  }

  const materials = await listMaterials();
  return { ...classifyMaterials(materials), configured: true };
}
