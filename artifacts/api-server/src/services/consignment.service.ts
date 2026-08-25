// What the studio has out at the skate shop, and what it has been paid for.
//
// The atelier leaves finished pieces at a local skate shop to sell. Each drop is
// a "placement" row: units delivered, and — once the two of them count the shelf
// at the next visit — units sold, units brought back, and the studio's payout.
// The app has never read any of it, so the dashboard's shop figures reported
// only what the website took, and a rail of soakers sitting in another shop
// appeared nowhere at all.
//
// Three decisions shape everything below:
//
//  1. **Sales are only known at settlement, so this reports two different
//     kinds of fact and never blurs them.** Units at the shop are stock the
//     studio still owns; payouts are money it has been paid. An unsettled
//     placement has UNKNOWN sales (`Qty Sold` is blank by design) — reading that
//     as zero would report every piece as still sitting on the shelf.
//  2. **The money is read, not derived.** `Your Payout` is the atelier's own
//     formula over their deal with the shop (half of retail today). Deriving it
//     from a rate hardcoded here would silently keep paying the old split the
//     day they renegotiate. Units, being arithmetic, are derived — see the
//     schema header.
//  3. **A payout belongs to the month it was SETTLED**, not to the months the
//     pieces sold in, which nobody recorded. That is also why consignment money
//     stays out of the month-by-month chart: one settlement is a lump covering
//     weeks of trade, and plotted against months of website orders it would read
//     as a spike in a month where nothing was sold.

import {
  consignmentConfigured,
  listConsignmentPlacements,
} from "../lib/notion/consignment.repository.js";
import type { ConsignmentRecord } from "../lib/notion/consignment.schema.js";
import { isNotionNotFound } from "../lib/notion/errors.js";
import { logger } from "../lib/logger.js";

/** How many pieces the panel lists on each side. */
export const CONSIGNMENT_ITEMS_LIMIT = 10;

/** One piece, as the consignment panel lists it. */
export interface ConsignmentItem {
  /** The inventory page id, so the caller can resolve the piece's name. */
  itemId?: string;
  /** Units still on the shop's shelf across unsettled placements. */
  atShop: number;
  /** Units the shop has sold and settled for. */
  sold: number;
}

/** The consignment shelf and its takings, as the dashboard reads them. */
export interface ConsignmentOverview {
  /** False when `NOTION_CONSIGNMENT_DATABASE_ID` is unset — the panel says the
   * shelf isn't tracked rather than showing an empty one. */
  configured: boolean;
  /** True when the id is set but Notion can't see the database (never shared,
   * or the wrong id). Same kind of state as unset — a human has to fix it. */
  unreachable?: boolean;
  /** Placements not yet settled. */
  openPlacements: number;
  /** Units still on the shop's shelf, across those placements. */
  atShopUnits: number;
  /** What those units would fetch at their shelf price. Retail, NOT the
   * studio's share — nothing has been sold yet, so there is no payout to
   * quote; this is the value of stock standing somewhere else. */
  atShopRetail: number;
  /** Units sold across settled placements. */
  settledUnits: number;
  /** The studio's share of those sales, read off the atelier's own formula. */
  settledPayout: number;
  /** Settled placements whose payout formula produced no number, so their money
   * is missing from `settledPayout`. Named rather than silently absent. */
  payoutUnknownPlacements: number;
  /** Per piece, most at-shop first. Names are resolved by the caller. */
  items: ConsignmentItem[];
}

/**
 * Units of a placement still sitting on the shop's shelf.
 *
 * Derived rather than read off the `Still At Shop` formula for the reason the
 * materials panel re-derives its restock trip: a formula's rendered value is the
 * atelier's to restyle, and a filter on one derived from rollups 400s anyway.
 * The rule is duplicated in Notion and here — CHANGE ONE AND CHANGE THE OTHER.
 *
 * Settled ⇒ zero, whatever the numbers say: the shelf was counted and the
 * placement closed, so anything unaccounted for was resolved at the visit.
 */
export function unitsAtShop(placement: ConsignmentRecord): number {
  if (placement.settled) return 0;
  const delivered = placement.delivered ?? 0;
  const returned = placement.returned ?? 0;
  const sold = placement.sold ?? 0;
  return Math.max(0, delivered - returned - sold);
}

/**
 * Fold placements into the dashboard's view. Pure, so every rule above is
 * testable without Notion.
 *
 * `window` bounds which settled placements count toward the takings — the same
 * trailing months the revenue series covers, so the two figures answer the same
 * question about the same period. A settled placement with no `Settled On` date
 * can't be placed in a month, so it contributes units and money to nothing; it
 * is left out rather than dropped into the current month.
 */
export function summarizeConsignment(
  placements: ConsignmentRecord[],
  window?: { from: string; to: string },
): Omit<ConsignmentOverview, "configured"> {
  let openPlacements = 0;
  let atShopUnits = 0;
  let atShopRetail = 0;
  let settledUnits = 0;
  let settledPayout = 0;
  let payoutUnknownPlacements = 0;

  const byItem = new Map<string, ConsignmentItem>();
  const itemEntry = (itemId?: string): ConsignmentItem => {
    const key = itemId ?? "";
    let entry = byItem.get(key);
    if (!entry) {
      entry = { ...(itemId ? { itemId } : {}), atShop: 0, sold: 0 };
      byItem.set(key, entry);
    }
    return entry;
  };

  for (const placement of placements) {
    const entry = itemEntry(placement.itemId);

    if (!placement.settled) {
      const units = unitsAtShop(placement);
      openPlacements += 1;
      atShopUnits += units;
      atShopRetail += units * (placement.retailPrice ?? 0);
      entry.atShop += units;
      continue;
    }

    if (!withinWindow(placement.settledOn, window)) continue;
    // `Qty Sold` is filled in at settlement; a settled placement that still has
    // none genuinely sold none we know of, so zero is right HERE (unlike on an
    // open one, where blank means "not counted yet").
    const sold = placement.sold ?? 0;
    settledUnits += sold;
    entry.sold += sold;
    if (placement.payout === null) {
      if (sold > 0) payoutUnknownPlacements += 1;
    } else {
      settledPayout += placement.payout;
    }
  }

  const items = [...byItem.values()]
    .filter((item) => item.atShop > 0 || item.sold > 0)
    .sort((a, b) => b.atShop - a.atShop || b.sold - a.sold)
    .slice(0, CONSIGNMENT_ITEMS_LIMIT);

  return {
    openPlacements,
    atShopUnits,
    atShopRetail: round2(atShopRetail),
    settledUnits,
    settledPayout: round2(settledPayout),
    payoutUnknownPlacements,
    items,
  };
}

/** Whether a settlement date falls inside the reporting window. A blank date
 * falls outside every window — it can't be placed in a month, and guessing one
 * would move real money into a period it didn't happen in. */
function withinWindow(
  settledOn: string,
  window?: { from: string; to: string },
): boolean {
  if (!window) return Boolean(settledOn);
  if (!settledOn) return false;
  // Notion dates are ISO, and ISO dates sort lexicographically; comparing the
  // first ten characters treats a date and a datetime alike.
  const day = settledOn.slice(0, 10);
  return day >= window.from && day <= window.to;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The consignment shelf for the studio dashboard.
 *
 * Degrades exactly like the materials panel: an unset database id reports
 * `configured: false`, and a Notion 404 — the id set but the integration never
 * shared with it — reports `unreachable`, because both are configuration a human
 * has to clear rather than an outage worth a 500 and an alert email on every
 * dashboard load. Anything else still throws.
 */
export async function getConsignmentOverview(window?: {
  from: string;
  to: string;
}): Promise<ConsignmentOverview> {
  const empty = summarizeConsignment([], window);

  if (!consignmentConfigured()) {
    return { ...empty, configured: false };
  }

  try {
    const placements = await listConsignmentPlacements();
    return { ...summarizeConsignment(placements, window), configured: true };
  } catch (err) {
    if (!isNotionNotFound(err)) throw err;
    logger.warn(
      { err },
      "Consignment database is configured but Notion cannot see it; check the id and that the integration is shared with it",
    );
    return { ...empty, configured: true, unreachable: true };
  }
}
