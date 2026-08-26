// Read-side mapping for the Notion "Category Pay Splits" database — how the
// value of a finished piece is divided between the five stages of making it.
//
// One row per product category (Dress, Skate Soakers, Hair Accessory, …), and
// five percentages against it: consult & sketch, sourcing, cutting & pinning,
// sewing, detailing. A dress is 15 / 10 / 20 / 35 / 20; a pair of soakers is
// 0 / 0 / 30 / 70 / 0, because nobody sketches a soaker.
//
// The app only ever READS this. These are the atelier's own commercial terms —
// what a stage of work is worth as a share of the piece — and they are
// renegotiated between the two of them, not deployed. Holding a copy of the
// numbers in code would silently keep paying last season's split.
//
// Two things about the shape are load-bearing:
//
//  1. **The percentages are read; the money is derived from them.** This is the
//     same division of labour as the consignment reader, arrived at from the
//     other side: there, the payout RATE is a commercial term so the money is
//     read off the formula and only the units are computed. Here the rate is
//     what this database IS, so it is read, and the multiplication against an
//     item's value is ours. What is never done in either place is inventing a
//     rate in code.
//  2. **A missing percentage is a zero, and that is safe here.** Unlike stock
//     on hand — where absent means "never counted" and must not read as none —
//     a blank split genuinely means that stage takes no share of this category.
//     The atelier leaves `Consult & sketch` blank on soakers rather than typing
//     a nought. The row's total is reported alongside so a category whose five
//     shares don't add up to the whole piece is visible rather than quietly
//     under-paying whoever did the missing stage.

/** Live-schema property names (a Notion rename is a one-line change here). */
export const PAY_SPLIT_CATEGORY_PROPERTY = "Category"; // title
export const PAY_SPLIT_CONSULT_PROPERTY = "Consult & sketch"; // number (percent)
export const PAY_SPLIT_SOURCING_PROPERTY = "Sourcing"; // number (percent)
export const PAY_SPLIT_CUTTING_PROPERTY = "Cutting & pinning"; // number (percent)
export const PAY_SPLIT_SEWING_PROPERTY = "Sewing"; // number (percent)
export const PAY_SPLIT_DETAILING_PROPERTY = "Detailing"; // number (percent)

/**
 * The five shares of a category's value, keyed by production-stage id.
 *
 * Fractions of one, as Notion stores a `percent`-formatted number: a dress's
 * 35% sewing share is `0.35` here, never `35`.
 */
export interface PaySplitShares {
  consult: number;
  sourcing: number;
  cutting: number;
  sewing: number;
  detailing: number;
}

/** One category's pay split, as the production-pay service reads it. */
export interface PaySplitRecord {
  /** The Notion page id — what a work-distribution row's `Category` relation
   * points at, and so the key the join is made on. */
  id: string;
  /** The category's name, e.g. "Dress". Display only; the join is by id. */
  category: string;
  /** The five stage shares. */
  shares: PaySplitShares;
}

// Raw Notion property shapes we read back (only the types we touch).
type NotionReadProperty =
  | { type: "title"; title: Array<{ plain_text: string }> }
  | { type: "number"; number: number | null };

export interface NotionPaySplitPage {
  id: string;
  properties: Record<string, NotionReadProperty | undefined>;
}

function readTitle(page: NotionPaySplitPage, name: string): string {
  const prop = page.properties[name];
  if (prop?.type !== "title") return "";
  return prop.title
    .map((part) => part.plain_text)
    .join("")
    .trim();
}

/**
 * A share as a fraction of one.
 *
 * Blank reads as no share (see decision 2 in the header). A negative share
 * would pay somebody backwards out of the pool, so it is floored at zero —
 * a typed minus sign is a slip, never an instruction.
 */
function readShare(page: NotionPaySplitPage, name: string): number {
  const prop = page.properties[name];
  if (prop?.type !== "number") return 0;
  const value = prop.number;
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

/** Map a scanned Notion page to a {@link PaySplitRecord}. Pure. */
export function extractPaySplit(page: NotionPaySplitPage): PaySplitRecord {
  return {
    id: page.id,
    category: readTitle(page, PAY_SPLIT_CATEGORY_PROPERTY),
    shares: {
      consult: readShare(page, PAY_SPLIT_CONSULT_PROPERTY),
      sourcing: readShare(page, PAY_SPLIT_SOURCING_PROPERTY),
      cutting: readShare(page, PAY_SPLIT_CUTTING_PROPERTY),
      sewing: readShare(page, PAY_SPLIT_SEWING_PROPERTY),
      detailing: readShare(page, PAY_SPLIT_DETAILING_PROPERTY),
    },
  };
}

/** What the five shares add up to. `1` means the whole piece is accounted for;
 * anything else is a category worth flagging to the atelier, since the residue
 * is value nobody is being paid for. */
export function sharesTotal(shares: PaySplitShares): number {
  return (
    shares.consult +
    shares.sourcing +
    shares.cutting +
    shares.sewing +
    shares.detailing
  );
}
