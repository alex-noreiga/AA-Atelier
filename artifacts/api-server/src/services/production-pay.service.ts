// What the studio owes its own people, HTTP-agnostic.
//
// The dashboard has always reported money coming IN — revenue by month,
// deposits against balances, what customers still owe. It has never reported
// money going OUT to the two people who make the garments, even though the
// atelier has recorded exactly that by hand since before the app existed: a
// "work distribution" row per item naming who did the consult, the sourcing,
// the cutting, the sewing and the detailing, and a "Category Pay Splits" row
// saying what each of those stages is worth as a share of the piece.
//
// This is the read that joins the two and answers "who is owed what".
//
// Five decisions this owns beyond "call Notion":
//
//  1. **The splits are read; the money is derived from them.** What a stage of
//     work is worth is a commercial term the two of them renegotiate, so it is
//     read off their own database, never a rate invented here. Multiplying it
//     against an item's value is arithmetic, so that is done here — the same
//     division the consignment reader makes between `Your Payout` (read) and
//     units on the shelf (derived).
//
//     Notion also carries `Alexandra owed` and `Alayna owed` formulas doing
//     this same multiplication, and reading those two numbers would have been
//     less code. It is rejected because those property names hardcode today's
//     two makers — see `lib/notion/work-distribution.schema.ts` decision 1 for
//     the full argument, and for the standing cost: the owed arithmetic now
//     exists in both places and CHANGING ONE MEANS CHANGING THE OTHER.
//  2. **Pay is attributed per STAGE, which is what makes the panel worth
//     opening.** A single "owed" total per person can be read off Notion
//     already. What it cannot say is that a maker is owed most of it for sewing
//     rather than sourcing — which is the fact the atelier settles up on, and
//     the fact a per-person formula structurally cannot produce.
//  3. **`Split` is halved across the roster, and the roster is the whole
//     roster.** With the two makers the studio has today that is the plain 50/50
//     everyone means by it. Were a third maker added, a stage marked `Split`
//     would divide three ways — which is stated here rather than guessed at,
//     because the alternative (picking two names out of the roster) would be
//     the app deciding who worked on a piece.
//  4. **Nothing that can't be computed is dropped — it is NAMED.** A row with
//     no sale price, no category, or a stage nobody has been assigned to is
//     money that may be owed and isn't in any total. Silently skipping it makes
//     the panel read as complete when it is short, which for a figure someone
//     is paid against is the worst way to be wrong. Same shape as the materials
//     panel's `untracked` list.
//  5. **Owed means "not ticked paid", and nothing else.** Whether work on a
//     half-sewn dress has been earned yet is the atelier's judgement, recorded
//     by ticking the checkbox. The order's stage rides along on each row so
//     they can see it, but the app never gates pay on it — inventing an
//     earned-at-delivery rule would contradict the table they already keep.

import {
  listWorkDistribution,
  fetchLiveMakerRoster,
  workDistributionConfigured,
} from "../lib/notion/work-distribution.repository.js";
import {
  listPaySplits,
  paySplitsConfigured,
} from "../lib/notion/pay-splits.repository.js";
import {
  PRODUCTION_STAGES,
  SPLIT_ASSIGNEE,
  type ProductionStageId,
  type WorkDistributionRecord,
} from "../lib/notion/work-distribution.schema.js";
import {
  sharesTotal,
  type PaySplitRecord,
  type PaySplitShares,
} from "../lib/notion/pay-splits.schema.js";
import { isNotionNotFound } from "../lib/notion/errors.js";
import { logger } from "../lib/logger.js";

/** How many item rows the panel lists. The list is a working surface, not an
 * archive: the atelier settles up against what is still owed, and the whole
 * book stays readable in Notion. */
export const PRODUCTION_PAY_ITEMS_LIMIT = 60;

/** How many unattributable rows to name before saying "and N more". */
export const PRODUCTION_PAY_ATTENTION_LIMIT = 30;

/** How far a category's five shares may stray from the whole piece before it is
 * worth flagging. A whisker, to absorb the floating-point residue of adding
 * `0.15 + 0.1 + 0.2 + 0.35 + 0.2` — not a tolerance for a typo. */
const SHARE_TOTAL_EPSILON = 0.005;

/** What one maker earned on one stage of one item. */
export interface StagePay {
  /** The stage id — `consult`, `sourcing`, `cutting`, `sewing`, `detailing`. */
  stage: ProductionStageId;
  /** Money attributed to this maker for this stage of this row. */
  amount: number;
  /** True when the stage was marked `Split`, so this is a share of it rather
   * than the whole. Reported so the panel can say why a sewing share on a
   * dress came to half what the category's split implies. */
  shared: boolean;
}

/** One maker's share of one item. */
export interface ItemMakerPay {
  /** The maker's name, exactly as the atelier typed it into the select. */
  maker: string;
  /** What they are due for this item, across every stage they worked on. */
  amount: number;
  /** Whether their `Paid <name>` checkbox is ticked on this row. */
  paid: boolean;
  /** Which stages that money is for. */
  stages: StagePay[];
}

/** One item being made, and what it owes whom. */
export interface ProductionPayItem {
  /** The Notion page id, so the panel can link back to the row. */
  id: string;
  /** The item's title, e.g. "Knight of Midnight Dress". */
  item: string;
  /** Size / colour / variation, when the atelier noted one. */
  product?: string;
  /** The category the splits came from, by name. Absent on a row with no
   * `Category` relation — which is also why it is in `needsAttention`. */
  category?: string;
  /** The order's current stage, when the row belongs to a commission. Shown so
   * the atelier can see what they are settling up on; never a pay gate. */
  orderStage?: string;
  /** `Sale price` × `Units` — the pot the five stage shares divide. */
  value: number;
  /** How many pieces the row covers. */
  units: number;
  /** Per maker, most owed first. */
  makers: ItemMakerPay[];
  /** Value belonging to stages nobody has been assigned to yet. Attributed to
   * no one and in no total, but reported so the row's shares visibly don't add
   * up to its value rather than invisibly not adding up. */
  unassigned: number;
}

/** A row no pay can be computed from, and why. */
export interface ProductionPayAttention {
  id: string;
  item: string;
  /** `"no-sale-price"` — nothing to divide. `"no-pay-split"` — no category
   * relation, or one pointing at a row the splits database doesn't hold.
   * `"unassigned-stages"` — priced and categorised, but some of the work has
   * no name against it, so part of its value is owed to nobody. */
  reason: "no-sale-price" | "no-pay-split" | "unassigned-stages";
  /** For `"unassigned-stages"`, the money hanging on those stages. */
  unassigned?: number;
}

/** One maker's totals across the whole book. */
export interface MakerPay {
  /** The maker's name, as typed in Notion. */
  maker: string;
  /** Due and not yet ticked paid. This is the figure the panel leads with. */
  owed: number;
  /** Due and ticked paid — what has already been settled. */
  paid: number;
  /** Everything they have earned, owed and settled together. */
  total: number;
  /** How many item rows still owe them something. */
  owedItems: number;
  /** What the outstanding money is for, most owed first. Only unpaid work
   * counts here: this is a breakdown of the `owed` figure, not of `total`. */
  owedByStage: Array<{ stage: ProductionStageId; amount: number }>;
}

/** A category whose five shares don't add up to the whole piece. */
export interface UnbalancedSplit {
  category: string;
  /** What the five shares actually total, as a fraction of one. */
  total: number;
}

/** Production pay, as the studio dashboard reads it. */
export interface ProductionPayOverview {
  /** False when either database is unset — the panel says which, rather than
   * showing nought owed, which would read as "everyone has been paid". */
  configured: boolean;
  /** Which of the two databases are missing, when `configured` is false. */
  missing?: Array<"work-distribution" | "pay-splits">;
  /** True when an id IS set but Notion answered 404 — never shared, or wrong.
   * Same kind of state as unset: a human has to clear it. */
  unreachable?: boolean;
  /** Per maker, most owed first. Includes a maker with nothing outstanding, so
   * the roster reads as the roster rather than as "who is owed money". */
  makers: MakerPay[];
  /** Owed across every maker — what the studio owes its people right now. */
  totalOwed: number;
  /** Settled across every maker. */
  totalPaid: number;
  /** Item rows, most owed first, capped at {@link PRODUCTION_PAY_ITEMS_LIMIT}. */
  items: ProductionPayItem[];
  /** How many item rows there are in all, so a capped list can say so. */
  itemCount: number;
  /** Rows no pay could be computed from, and why. */
  needsAttention: ProductionPayAttention[];
  /** How many such rows there are in all. */
  attentionCount: number;
  /** Categories whose shares don't total the whole piece — a mistyped split
   * silently underpays whoever did the missing stage, and this is the only
   * place that is visible. */
  unbalancedSplits: UnbalancedSplit[];
}

/**
 * Which makers a stage's value goes to.
 *
 * A named maker takes the stage whole. {@link SPLIT_ASSIGNEE} divides it evenly
 * across the roster — see decision 3 in the header. Anything else (blank, or a
 * `Split` with no roster to divide across) belongs to nobody, and the caller
 * reports the value as unassigned rather than quietly dropping it.
 */
export function resolveStageMakers(
  assignee: string,
  roster: readonly string[],
): string[] {
  const name = assignee.trim();
  if (!name) return [];
  if (name === SPLIT_ASSIGNEE) return [...roster];
  return [name];
}

/** `Sale price` × `Units`, or `null` when the row carries no price. */
export function itemValue(row: WorkDistributionRecord): number | null {
  if (row.salePrice === null) return null;
  return row.salePrice * row.units;
}

function shareFor(shares: PaySplitShares, stage: ProductionStageId): number {
  return shares[stage];
}

/**
 * Attribute one item's value across the makers who worked on it.
 *
 * Pure, and the whole rule of the feature: for each of the five stages, the
 * category's share of the item's value goes to whoever is named against that
 * stage — split evenly when the atelier marked it shared, and left unassigned
 * when nobody is named.
 *
 * Returns `null` when the row can't be priced or has no splits to divide by;
 * the caller turns that into a named `needsAttention` entry.
 */
export function attributeItem(
  row: WorkDistributionRecord,
  split: PaySplitRecord | undefined,
  roster: readonly string[],
): ProductionPayItem | null {
  const value = itemValue(row);
  if (value === null || !split) return null;

  const byMaker = new Map<string, ItemMakerPay>();
  let unassigned = 0;

  for (const stage of PRODUCTION_STAGES) {
    const stageValue = value * shareFor(split.shares, stage.id);
    if (stageValue === 0) continue;

    const makers = resolveStageMakers(row.assignees[stage.id], roster);
    if (makers.length === 0) {
      unassigned += stageValue;
      continue;
    }

    const each = stageValue / makers.length;
    const shared = makers.length > 1;
    for (const maker of makers) {
      let entry = byMaker.get(maker);
      if (!entry) {
        entry = {
          maker,
          amount: 0,
          // A maker with no `Paid <name>` column reads as unpaid — the safe
          // direction, since the panel may overstate what is owed but must
          // never hide it (schema decision 2).
          paid: row.paid[maker] ?? false,
          stages: [],
        };
        byMaker.set(maker, entry);
      }
      entry.amount += each;
      entry.stages.push({ stage: stage.id, amount: round2(each), shared });
    }
  }

  const makers = [...byMaker.values()]
    .map((entry) => ({ ...entry, amount: round2(entry.amount) }))
    .sort((a, b) => b.amount - a.amount || a.maker.localeCompare(b.maker));

  return {
    id: row.id,
    item: row.item,
    ...(row.product ? { product: row.product } : {}),
    ...(split.category ? { category: split.category } : {}),
    ...(row.orderStage ? { orderStage: row.orderStage } : {}),
    value: round2(value),
    units: row.units,
    makers,
    unassigned: round2(unassigned),
  };
}

/**
 * Fold the two databases into the dashboard's view. Pure, so every rule above
 * is testable without Notion.
 *
 * `roster` is the makers read from the live select options. Anyone assigned
 * work who isn't in it is folded in, so a name typed straight onto a row — or a
 * roster read that failed — can never cost somebody their pay; they simply
 * don't get a nought row when they have no work.
 */
export function summarizeProductionPay(
  rows: readonly WorkDistributionRecord[],
  splits: readonly PaySplitRecord[],
  roster: readonly string[],
): Omit<ProductionPayOverview, "configured"> {
  const splitById = new Map(splits.map((split) => [split.id, split]));
  const makerRoster = expandRoster(rows, roster);

  const items: ProductionPayItem[] = [];
  const needsAttention: ProductionPayAttention[] = [];
  const totals = new Map<string, MakerPay>();
  const owedStages = new Map<string, Map<ProductionStageId, number>>();

  const makerTotals = (maker: string): MakerPay => {
    let entry = totals.get(maker);
    if (!entry) {
      entry = {
        maker,
        owed: 0,
        paid: 0,
        total: 0,
        owedItems: 0,
        owedByStage: [],
      };
      totals.set(maker, entry);
      owedStages.set(maker, new Map());
    }
    return entry;
  };

  // Every maker on the roster gets a row, even at nought — the panel is the
  // studio's payroll, so a maker who is square should read as square rather
  // than as absent.
  for (const maker of makerRoster) makerTotals(maker);

  for (const row of rows) {
    const split = row.categoryId ? splitById.get(row.categoryId) : undefined;
    const attributed = attributeItem(row, split, makerRoster);

    if (!attributed) {
      needsAttention.push({
        id: row.id,
        item: row.item,
        // Price first: a row with neither is one nobody has filled in yet, and
        // "no sale price" is the thing to fix before the category matters.
        reason: itemValue(row) === null ? "no-sale-price" : "no-pay-split",
      });
      continue;
    }

    items.push(attributed);

    for (const maker of attributed.makers) {
      const entry = makerTotals(maker.maker);
      entry.total = round2(entry.total + maker.amount);
      if (maker.paid) {
        entry.paid = round2(entry.paid + maker.amount);
        continue;
      }
      entry.owed = round2(entry.owed + maker.amount);
      entry.owedItems += 1;
      const stages = owedStages.get(maker.maker);
      if (stages) {
        for (const stage of maker.stages) {
          stages.set(
            stage.stage,
            (stages.get(stage.stage) ?? 0) + stage.amount,
          );
        }
      }
    }

    if (attributed.unassigned > 0) {
      needsAttention.push({
        id: row.id,
        item: row.item,
        reason: "unassigned-stages",
        unassigned: attributed.unassigned,
      });
    }
  }

  for (const [maker, stages] of owedStages) {
    const entry = totals.get(maker);
    if (!entry) continue;
    entry.owedByStage = [...stages.entries()]
      .map(([stage, amount]) => ({ stage, amount: round2(amount) }))
      .filter((stage) => stage.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }

  const makers = [...totals.values()].sort(
    (a, b) =>
      b.owed - a.owed || b.total - a.total || a.maker.localeCompare(b.maker),
  );

  return {
    makers,
    totalOwed: round2(makers.reduce((sum, maker) => sum + maker.owed, 0)),
    totalPaid: round2(makers.reduce((sum, maker) => sum + maker.paid, 0)),
    items: [...items]
      .sort((a, b) => owedOn(b) - owedOn(a) || b.value - a.value)
      .slice(0, PRODUCTION_PAY_ITEMS_LIMIT),
    itemCount: items.length,
    needsAttention: needsAttention.slice(0, PRODUCTION_PAY_ATTENTION_LIMIT),
    attentionCount: needsAttention.length,
    unbalancedSplits: splits
      .filter(
        (split) =>
          Math.abs(sharesTotal(split.shares) - 1) > SHARE_TOTAL_EPSILON,
      )
      .map((split) => ({
        category: split.category,
        total: Math.round(sharesTotal(split.shares) * 1000) / 1000,
      }))
      .sort((a, b) => a.category.localeCompare(b.category)),
  };
}

/** What an item still owes, across every maker on it. Ranks the list, so the
 * rows the atelier still has to settle lead. */
function owedOn(item: ProductionPayItem): number {
  return item.makers.reduce(
    (sum, maker) => (maker.paid ? sum : sum + maker.amount),
    0,
  );
}

/**
 * The roster, widened by anyone the rows name who isn't on it.
 *
 * The live select options are the roster proper, but a name can reach a row
 * without being one — a schema read that failed, or an option added and then
 * removed. Widening rather than filtering is the safe direction here for the
 * same reason unpaid is: pay may be attributed to somebody unexpected, which is
 * visible, rather than vanishing, which is not.
 */
function expandRoster(
  rows: readonly WorkDistributionRecord[],
  roster: readonly string[],
): string[] {
  const names = new Set(roster);
  for (const row of rows) {
    for (const stage of PRODUCTION_STAGES) {
      const name = row.assignees[stage.id].trim();
      if (name && name !== SPLIT_ASSIGNEE) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Production pay for the studio dashboard.
 *
 * Degrades exactly like the materials and consignment panels: an unset database
 * id reports `configured: false` naming which one, and a Notion 404 — the id
 * set but the integration never shared with it — reports `unreachable`, because
 * both are configuration a human has to clear rather than an outage worth a 500
 * and an alert email on every dashboard load. Anything else still throws.
 *
 * The roster read is the one BEST-EFFORT source: a failure there costs a maker
 * with no work their nought row, and nothing else, because `summarizeProductionPay`
 * widens whatever roster it is handed with the names the rows themselves carry.
 */
export async function getProductionPayOverview(): Promise<ProductionPayOverview> {
  const empty = summarizeProductionPay([], [], []);

  const missing: Array<"work-distribution" | "pay-splits"> = [];
  if (!workDistributionConfigured()) missing.push("work-distribution");
  if (!paySplitsConfigured()) missing.push("pay-splits");
  if (missing.length > 0) {
    return { ...empty, configured: false, missing };
  }

  try {
    const [rows, splits] = await Promise.all([
      listWorkDistribution(),
      listPaySplits(),
    ]);

    let roster: string[] = [];
    try {
      roster = await fetchLiveMakerRoster();
    } catch (err) {
      logger.warn(
        { err },
        "Could not read the work distribution maker roster; falling back to the names on the rows",
      );
    }

    return {
      ...summarizeProductionPay(rows, splits, roster),
      configured: true,
    };
  } catch (err) {
    if (!isNotionNotFound(err)) throw err;
    logger.warn(
      { err },
      "A production-pay database is configured but Notion cannot see it; check the ids and that the integration is shared with both",
    );
    return { ...empty, configured: true, unreachable: true };
  }
}
