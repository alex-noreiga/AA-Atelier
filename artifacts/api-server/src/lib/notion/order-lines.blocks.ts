// Builds the Notion `properties` for a NEW "order lines" row — one per item
// purchased on a shop order. Kept apart from the HTTP/Notion request layer so
// the Stripe-line -> Notion mapping is independently testable, the same split as
// the other `*.blocks.ts` builders.
//
// WHY THIS ROW EXISTS: the inventory database's `Units Sold (auto)` rollup sums
// each line's `Counts Toward Sold` formula (its `Qty`, unless the parent order
// is `Voided`) through the line's `Item` relation, and `Quantity Available`
// subtracts that. So writing these rows IS the shop's stock decrement — there is
// no writable count property to decrement and nothing else to keep in step. A
// line with no `Item` relation contributes nothing, which is why the caller
// skips a Stripe line it can't resolve to an inventory row rather than writing a
// dangling one (see `services/order-lines.service.ts`).
//
// Property *types* here must match the live "order lines" schema, not the
// property name (the same lesson as every other blocks builder).

// Live-schema property names (a Notion rename is a one-line change here).
export const ORDER_LINE_TITLE_PROPERTY = "Line"; // title
export const ORDER_LINE_ITEM_PROPERTY = "Item"; // relation -> inventory
export const ORDER_LINE_ORDER_PROPERTY = "Order"; // relation -> shop orders
export const ORDER_LINE_QTY_PROPERTY = "Qty"; // number
export const ORDER_LINE_UNIT_PRICE_PROPERTY = "Unit Price"; // number (dollars)
export const ORDER_LINE_SIZE_PROPERTY = "Size"; // select

/** One purchased item, resolved from a paid Stripe Checkout session. */
export interface OrderLineInput {
  /** The Notion page id of the shop order this line belongs to. */
  orderPageId: string;
  /** The inventory row's Notion page id (`variantId === page id`). */
  itemPageId: string;
  /** The line title — the purchased item's name as the customer saw it. */
  name: string;
  /** Units bought on this line. */
  quantity: number;
  /** Dollars per unit, at the listed price (discounts show as the gap between
   * the order's `Items Subtotal` rollup and its `Total`). */
  unitPrice: number;
  /** The size band bought, for a sized item. Omitted for one-size pieces. */
  size?: string;
}

/** Notion page `properties` for one order line. */
export function buildOrderLineProperties(
  input: OrderLineInput,
): Record<string, unknown> {
  return {
    [ORDER_LINE_TITLE_PROPERTY]: {
      title: [{ text: { content: input.name } }],
    },
    [ORDER_LINE_ORDER_PROPERTY]: {
      relation: [{ id: input.orderPageId }],
    },
    [ORDER_LINE_ITEM_PROPERTY]: {
      relation: [{ id: input.itemPageId }],
    },
    [ORDER_LINE_QTY_PROPERTY]: {
      number: input.quantity,
    },
    [ORDER_LINE_UNIT_PRICE_PROPERTY]: {
      number: input.unitPrice,
    },
    // Notion auto-creates a `select` option it hasn't seen, and the sizes we
    // send come from the inventory's own `Sizes Available` vocabulary, so this
    // can't drift into an unknown band. Omitted entirely for a one-size piece.
    ...(input.size
      ? { [ORDER_LINE_SIZE_PROPERTY]: { select: { name: input.size } } }
      : {}),
  };
}
