// Generate a custom order's itemized invoice lines from its costing, on demand.
//
// The atelier builds the costing in Notion (costing item → material usage lines
// + labor + a margin-loaded Suggested Price) and then presses a button; this
// mirrors that costing into "Invoice Line Items" so the customer sees a detailed
// breakdown. It does NOT own the costing — every price is read from Notion.
//
// The shape is deliberately double-charge-proof (see `.agents/memory/invoice-building.md`):
//   - one Material line per non-packaging usage line, priced at that line's cost;
//   - one Labor line, at the summed costing Labor Cost;
//   - one reconciling "Design & finishing" Adjustment line = Σ Suggested Price −
//     (materials + labor), which folds the margin in and makes the itemized total
//     land exactly on the costing's Suggested Price.
// No line links the costing-item aggregate, and each line prices via Manual Unit
// Price, so materials/labor/margin are each counted once and never doubled.
//
// Idempotent: if the invoice already has any line items we skip generation (and
// just reconcile the title), so a re-press never duplicates. To regenerate after
// changing the costing, delete the existing lines and press again.

import { findOrderByNumber } from "../lib/notion/orders.repository.js";
import {
  listInvoiceLineItems,
  createInvoiceLineItem,
  setInvoiceTitle,
} from "../lib/notion/invoice.repository.js";
import {
  getCostingItem,
  getMaterialUsageLine,
} from "../lib/notion/costing.repository.js";
import { USAGE_TYPE_PACKAGING } from "../lib/notion/costing.schema.js";
import {
  LINE_TYPE_MATERIAL,
  LINE_TYPE_LABOR,
  LINE_TYPE_ADJUSTMENT,
  RECONCILING_LINE_NAME,
} from "../lib/notion/invoice-line-items.blocks.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";

/** Round a dollar amount to whole cents, killing float-sum noise. */
function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Below this (half a cent) a reconciling adjustment is treated as zero and no
 * line is written — the materials + labor already equal the suggested price. */
const ADJUSTMENT_EPSILON = 0.005;

export interface LineItemGenerationResult {
  orderNumber: string;
  /** The invoice already had line items, so generation was skipped (the title
   * was still reconciled to the order number). */
  alreadyPresent: boolean;
  materialLinesCreated: number;
  laborLineCreated: boolean;
  adjustmentLineCreated: boolean;
  /** The itemized total in dollars (materials + labor + adjustment) — equals the
   * costing's summed Suggested Price when an adjustment was written. */
  invoiceTotal: number;
}

/**
 * Generate the itemized invoice lines for one custom order. Prices are read from
 * the order's costing items; nothing is recomputed. Throws NotFound/BadRequest
 * for the caller to surface; returns a summary the button page renders.
 */
export async function generateInvoiceLineItems(
  orderNumber: string,
): Promise<LineItemGenerationResult> {
  const order = await findOrderByNumber(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }
  if (!order.pageId || !order.invoicePageId) {
    throw new BadRequestError("There's no invoice for this order yet.");
  }
  const { pageId: orderPageId, invoicePageId } = order;

  // Name the invoice after the order number regardless of itemization state, so
  // a press always reconciles the title (this is also idempotent).
  await setInvoiceTitle(invoicePageId, order.orderNumber);

  const costingItemIds = order.costingItemIds ?? [];
  if (costingItemIds.length === 0) {
    throw new BadRequestError("This order has no costing items to itemize.");
  }

  // Idempotency guard: don't add to an invoice that already has lines (a prior
  // generation, or lines the atelier added by hand). Report it instead.
  const existing = await listInvoiceLineItems(invoicePageId);
  if (existing.length > 0) {
    return {
      orderNumber: order.orderNumber,
      alreadyPresent: true,
      materialLinesCreated: 0,
      laborLineCreated: false,
      adjustmentLineCreated: false,
      invoiceTotal: 0,
    };
  }

  // Walk the costing: sum labor + suggested price across the order's costing
  // items, and collect every material usage line under them.
  let laborTotal = 0;
  let suggestedTotal = 0;
  const usageLineIds: string[] = [];
  for (const costingItemId of costingItemIds) {
    const costing = await getCostingItem(costingItemId);
    if (!costing) continue; // dangling relation — skip, don't fail the invoice
    laborTotal += costing.laborCost;
    suggestedTotal += costing.suggestedPrice;
    usageLineIds.push(...costing.usageLineIds);
  }

  // One Material line per non-packaging usage line, priced at that line's cost.
  let materialTotal = 0;
  let materialLinesCreated = 0;
  for (const usageLineId of usageLineIds) {
    const usage = await getMaterialUsageLine(usageLineId);
    if (!usage) continue;
    if (usage.usageType === USAGE_TYPE_PACKAGING) continue; // internal cost
    const unitPrice = roundCents(usage.materialCost);
    await createInvoiceLineItem({
      invoicePageId,
      orderPageId,
      name: usage.name || "Material",
      lineType: LINE_TYPE_MATERIAL,
      unitPrice,
      materialUsageLineId: usageLineId,
    });
    materialTotal = roundCents(materialTotal + unitPrice);
    materialLinesCreated += 1;
  }

  // One Labor line at the summed labor cost (omitted when there's no labor).
  laborTotal = roundCents(laborTotal);
  let laborLineCreated = false;
  if (laborTotal > 0) {
    await createInvoiceLineItem({
      invoicePageId,
      orderPageId,
      name: "Labor",
      lineType: LINE_TYPE_LABOR,
      unitPrice: laborTotal,
    });
    laborLineCreated = true;
  }

  // One reconciling adjustment that folds the margin in, so the itemized total
  // equals the costing's Suggested Price. Skipped when it rounds to ~zero.
  const adjustment = roundCents(suggestedTotal - (materialTotal + laborTotal));
  let adjustmentLineCreated = false;
  if (Math.abs(adjustment) >= ADJUSTMENT_EPSILON) {
    await createInvoiceLineItem({
      invoicePageId,
      orderPageId,
      name: RECONCILING_LINE_NAME,
      lineType: LINE_TYPE_ADJUSTMENT,
      unitPrice: adjustment,
    });
    adjustmentLineCreated = true;
  }

  return {
    orderNumber: order.orderNumber,
    alreadyPresent: false,
    materialLinesCreated,
    laborLineCreated,
    adjustmentLineCreated,
    invoiceTotal: roundCents(
      materialTotal + laborTotal + (adjustmentLineCreated ? adjustment : 0),
    ),
  };
}
