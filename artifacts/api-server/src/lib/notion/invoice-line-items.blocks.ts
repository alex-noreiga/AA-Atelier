// Builds the Notion `properties` for a NEW "Invoice Line Items" row the invoice
// generator writes (services/invoice-generator.service.ts). Kept apart from the
// read-side `invoice.schema.ts` (which maps existing lines) so the writer's
// property mapping is independently testable, same split as the other
// `*.blocks.ts` builders.
//
// Load-bearing pricing decision: every generated line prices via `Manual Unit
// Price` (the highest-precedence source in the `Unit Price` formula) at quantity
// 1, so its `Line Total` is exactly the amount we computed. Generated lines
// deliberately DO NOT link the `Costing Item`: that relation only feeds the
// price when Manual Unit Price is blank, and a Material line linked to the
// costing item would then pull the whole-garment aggregate — the exact
// double-charge this feature exists to prevent. See `.agents/memory/invoice-building.md`.

import {
  LINE_ITEM_TITLE_PROPERTY,
  LINE_ITEM_TYPE_PROPERTY,
  LINE_ITEM_INVOICE_RELATION_PROPERTY,
} from "./invoice.schema.js";

// Write-side property names (the read side only ever needed the title/type/total
// + invoice relation). A Notion rename is a one-line change here.
export const LINE_ITEM_MANUAL_UNIT_PRICE_PROPERTY = "Manual Unit Price"; // number
export const LINE_ITEM_QUANTITY_PROPERTY = "Quantity"; // number
export const LINE_ITEM_ORDER_RELATION_PROPERTY = "Order"; // relation → orders
export const LINE_ITEM_MATERIAL_USAGE_RELATION_PROPERTY = "Material Usage Line"; // relation → material usage

// The three `Line Type` option values the generator writes. Named option values
// coupled to code (like `STATUS_IN_STOCK`) — rename them in Notion and update
// here too. "Adjustment" carries the reconciling margin line (see the service).
export const LINE_TYPE_MATERIAL = "Material";
export const LINE_TYPE_LABOR = "Labor";
export const LINE_TYPE_ADJUSTMENT = "Adjustment";

/** The customer-facing title for the reconciling margin/adjustment line — the
 * single line that folds the costing item's margin into the itemized total so it
 * lands exactly on `Suggested Price`. */
export const RECONCILING_LINE_NAME = "Design & finishing";

/** Everything needed to write one generated invoice line. */
export interface InvoiceLineItemInput {
  invoicePageId: string;
  orderPageId: string;
  /** The line title (a material's usage-line name, "Labor", or the adjustment). */
  name: string;
  /** A `LINE_TYPE_*` value. */
  lineType: string;
  /** Dollars — written to `Manual Unit Price` at quantity 1. */
  unitPrice: number;
  /** For a Material line only: the usage line it bills — provenance, and the
   * back-relation the generator uses to tell an already-billed line apart. */
  materialUsageLineId?: string;
}

/** Notion page `properties` for one generated invoice line. */
export function buildInvoiceLineItemProperties(
  input: InvoiceLineItemInput,
): Record<string, unknown> {
  return {
    [LINE_ITEM_TITLE_PROPERTY]: {
      title: [{ text: { content: input.name } }],
    },
    [LINE_ITEM_TYPE_PROPERTY]: {
      select: { name: input.lineType },
    },
    [LINE_ITEM_MANUAL_UNIT_PRICE_PROPERTY]: {
      number: input.unitPrice,
    },
    [LINE_ITEM_QUANTITY_PROPERTY]: {
      number: 1,
    },
    [LINE_ITEM_INVOICE_RELATION_PROPERTY]: {
      relation: [{ id: input.invoicePageId }],
    },
    [LINE_ITEM_ORDER_RELATION_PROPERTY]: {
      relation: [{ id: input.orderPageId }],
    },
    ...(input.materialUsageLineId
      ? {
          [LINE_ITEM_MATERIAL_USAGE_RELATION_PROPERTY]: {
            relation: [{ id: input.materialUsageLineId }],
          },
        }
      : {}),
  };
}
