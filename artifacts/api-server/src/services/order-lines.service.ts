// Records one Notion "order lines" row per item on a paid shop order — the
// shop's automatic inventory decrement.
//
// There is no writable stock count to decrement: the inventory's
// `Quantity Available` is a formula over a `Units Sold (auto)` rollup, which
// sums each order line's `Counts Toward Sold` (its `Qty`, unless the parent
// order is `Voided`) through the line's `Item` relation. So writing these rows
// IS the decrement, and the atelier's existing rollups do the arithmetic. Before
// this, checkout recorded the purchased items only as free text on the order
// page, the lines database stayed empty, and stock never moved.
//
// Load-bearing decisions:
//
//  1. BEST-EFFORT, ALWAYS. The lines are written after the shop order's own
//     Notion page, on the Stripe webhook path. A throw there would 500 the
//     webhook, Stripe would redeliver, and the redelivery would early-return at
//     the dedupe guard — losing the lines anyway and risking a duplicate order.
//     So every failure is caught and logged (at `error`: a missed line silently
//     drifts stock, which is worth seeing) and the paid order stands.
//  2. ONE LINE PER STRIPE LINE, and only for lines we can resolve to an
//     inventory row. The `Item` relation is what the rollup travels; a line
//     without it contributes nothing and would just be litter, so an
//     unresolvable line (a session created before checkout stamped the variant
//     id, or a deleted Stripe product) is skipped and counted in the log.
//  3. QUANTITY AND SIZE COME FROM STRIPE, not the cart. The webhook re-reads the
//     session from Stripe, so what's recorded is what was actually paid for.
//
// Known limit (deliberate, per the roadmap card): stock decrements at PAYMENT,
// with no reservation between checkout and payment, so two simultaneous
// checkouts can still oversell the last piece. Reservation logic would need a
// store of its own; the atelier's cap check at checkout is the only guard.

import type Stripe from "stripe";
import {
  createOrderLine,
  orderLinesConfigured,
} from "../lib/notion/order-lines.repository.js";
import type { OrderLineInput } from "../lib/notion/order-lines.blocks.js";
import { logger } from "../lib/logger.js";

/** One purchased line recovered from a paid Stripe session, before it's tied to
 * a shop order page. */
export type PurchasedLine = Omit<OrderLineInput, "orderPageId">;

/** Dollars per unit for a Stripe line: its listed unit price when Stripe kept
 * one, else the pre-tax subtotal spread over the quantity. Discounts are
 * deliberately NOT folded in — the order's `Items Subtotal` rollup is meant to
 * be compared against its `Total` to see shipping, fees and discounts. */
function unitPriceDollars(line: Stripe.LineItem, quantity: number): number {
  const unitAmount = line.price?.unit_amount;
  if (typeof unitAmount === "number") return unitAmount / 100;
  if (quantity <= 0) return 0;
  const subtotal = line.amount_subtotal ?? line.amount_total ?? 0;
  return Math.round(subtotal / quantity) / 100;
}

/**
 * Map a paid Stripe Checkout session's line items to order lines, reading the
 * inventory page id (and size) back from the metadata checkout stamped on each
 * ad-hoc product. Pure — exported for its own tests and reused by the shop
 * order's `Inventory Items` relation, so the two can't disagree about which
 * inventory rows an order touched.
 *
 * Requires the session to have been retrieved with
 * `expand: ["line_items.data.price.product"]`; without the expansion `product`
 * is a bare id string carrying no metadata and every line is skipped.
 */
export function purchasedLinesFromSession(session: Stripe.Checkout.Session): {
  lines: PurchasedLine[];
  skipped: number;
} {
  const lines: PurchasedLine[] = [];
  let skipped = 0;

  for (const line of session.line_items?.data ?? []) {
    const product = line.price?.product;
    // `product` is only an object when expanded (and not deleted); its metadata
    // carries the inventory page id. A string id or a deleted product yields none.
    const itemPageId =
      product && typeof product === "object" && "metadata" in product
        ? (product.metadata?.variantId ?? "")
        : "";
    if (!itemPageId) {
      skipped += 1;
      continue;
    }

    const size =
      product && typeof product === "object" && "metadata" in product
        ? (product.metadata?.size ?? "")
        : "";
    const quantity = line.quantity ?? 1;

    lines.push({
      itemPageId,
      name: line.description ?? "Item",
      quantity,
      unitPrice: unitPriceDollars(line, quantity),
      ...(size ? { size } : {}),
    });
  }

  return { lines, skipped };
}

/**
 * Write one order-line row per purchased item, so the inventory rollups move.
 * Never throws — see the header. No-ops when the order-lines database isn't
 * configured, so the pre-lines behavior is exactly what an unset env var gives.
 *
 * @returns how many line rows were written.
 */
export async function recordShopOrderLines(
  session: Stripe.Checkout.Session,
  orderPageId: string,
): Promise<number> {
  if (!orderLinesConfigured()) return 0;

  const { lines, skipped } = purchasedLinesFromSession(session);
  if (skipped > 0) {
    logger.warn(
      { sessionId: session.id, skipped },
      "Some purchased lines carry no inventory id — those items will not decrement stock",
    );
  }

  let written = 0;
  for (const line of lines) {
    try {
      await createOrderLine({ ...line, orderPageId });
      written += 1;
    } catch (err) {
      // Per-line, so one bad row doesn't cost the rest of the order its stock
      // movement. `error` because the shortfall is invisible in Notion.
      logger.error(
        { err, sessionId: session.id, itemPageId: line.itemPageId },
        "Failed to write a shop order line — inventory will not decrement for this item",
      );
    }
  }

  return written;
}
