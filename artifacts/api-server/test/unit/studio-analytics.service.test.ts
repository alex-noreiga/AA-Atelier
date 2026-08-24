import { describe, it, expect } from "vitest";
import {
  aggregateStudioAnalytics,
  REVENUE_MONTHS,
  UPCOMING_LIMIT,
  TOP_ITEMS_LIMIT,
  type StudioAnalyticsInput,
} from "../../src/services/studio-analytics.service.js";
import type { OrderAnalyticsRecord } from "../../src/lib/notion/orders.schema.js";
import type { ShopOrderAnalyticsRecord } from "../../src/lib/notion/shop-orders.repository.js";
import type { InvoiceAnalyticsRecord } from "../../src/lib/notion/invoice.schema.js";

const STAGES = ["Consultation", "Design", "Cutting/Pinning", "Delivered"];
const SHOP_STATUSES = ["Payment Confirmed", "Shipped", "Delivered"];
/** A fixed "now" so every window in these tests is deterministic. Read in UTC,
 * so today is 2026-08-18, the week cutoff 08-24 and the month cutoff 09-16. */
const NOW = new Date("2026-08-18T12:00:00.000Z");

let seq = 0;

function order(
  overrides: Partial<OrderAnalyticsRecord> = {},
): OrderAnalyticsRecord {
  seq += 1;
  return {
    pageId: `order-page-${seq}`,
    orderNumber: `ORD-${seq}`,
    orderName: `Order ${seq}`,
    stage: "Design",
    createdTime: "2026-08-01T10:00:00.000Z",
    cancelled: false,
    rush: false,
    // The bespoke commission's display name — the value a real order carries,
    // and the one the capacity count reads as gated.
    service: "Bespoke Commission",
    ...overrides,
  };
}

function shopOrder(
  overrides: Partial<ShopOrderAnalyticsRecord> = {},
): ShopOrderAnalyticsRecord {
  seq += 1;
  return {
    orderNumber: `SHP-${seq}`,
    status: "Shipped",
    cancelled: false,
    createdTime: "2026-08-02T10:00:00.000Z",
    itemIds: [],
    ...overrides,
  };
}

function invoice(
  overrides: Partial<InvoiceAnalyticsRecord> = {},
): InvoiceAnalyticsRecord {
  seq += 1;
  return {
    pageId: `invoice-page-${seq}`,
    depositsPaid: 0,
    depositsUnpaid: 0,
    balancePaid: false,
    ...overrides,
  };
}

function aggregate(input: Partial<StudioAnalyticsInput> = {}) {
  return aggregateStudioAnalytics({
    orders: [],
    stages: STAGES,
    shopOrders: [],
    shopStatuses: SHOP_STATUSES,
    invoices: [],
    itemNames: new Map(),
    now: NOW,
    timeZone: "UTC",
    ...input,
  });
}

describe("aggregateStudioAnalytics — pipelines", () => {
  it("counts active orders into their stage and classifies the rest", () => {
    const result = aggregate({
      orders: [
        order({ stage: "Design" }),
        order({ stage: "Design" }),
        order({ stage: "Cutting/Pinning" }),
        // The last live stage is "finished" — positionally, no name baked in.
        order({ stage: "Delivered" }),
        order({ stage: "Design", cancelled: true }),
      ],
    });

    expect(result.customOrders).toMatchObject({
      total: 5,
      active: 3,
      completed: 1,
      cancelled: 1,
    });
    expect(result.customOrders.stages).toEqual([
      { stage: "Consultation", count: 0 },
      { stage: "Design", count: 2 },
      { stage: "Cutting/Pinning", count: 1 },
      { stage: "Delivered", count: 0 },
    ]);
  });

  it("cancellation wins over completion", () => {
    const result = aggregate({
      orders: [order({ stage: "Delivered", cancelled: true })],
    });
    expect(result.customOrders.cancelled).toBe(1);
    expect(result.customOrders.completed).toBe(0);
  });

  it("still counts an order whose stage isn't in the live list as active", () => {
    const result = aggregate({ orders: [order({ stage: "Retired Stage" })] });
    expect(result.customOrders.active).toBe(1);
    expect(result.customOrders.stages.every((stage) => stage.count === 0)).toBe(
      true,
    );
  });

  it("places shop orders in their live fulfilment statuses", () => {
    const result = aggregate({
      shopOrders: [
        shopOrder({ status: "Payment Confirmed" }),
        shopOrder({ status: "Shipped" }),
        shopOrder({ status: "Delivered" }),
        shopOrder({ status: "Shipped", cancelled: true }),
      ],
    });

    expect(result.shopOrders).toMatchObject({
      total: 4,
      active: 2,
      completed: 1,
      cancelled: 1,
    });
    expect(result.shopOrders.stages).toEqual([
      { stage: "Payment Confirmed", count: 1 },
      { stage: "Shipped", count: 1 },
      { stage: "Delivered", count: 0 },
    ]);
  });
});

describe("aggregateStudioAnalytics — production load", () => {
  it("measures active orders against their due dates", () => {
    const result = aggregate({
      orders: [
        order({ dueDate: "2026-08-01" }), // overdue
        order({ dueDate: "2026-08-18" }), // due today → this week
        order({ dueDate: "2026-08-24" }), // last day of the 7-day window
        order({ dueDate: "2026-08-25" }), // beyond the week, inside the month
        order({ dueDate: "2026-12-01" }), // beyond both
        order({}), // no due date at all
        order({ dueDate: "2026-09-01", cancelled: true }), // not active
        order({ dueDate: "2026-09-01", stage: "Delivered" }), // finished
      ],
    });

    expect(result.production).toMatchObject({
      activeOrders: 6,
      scheduled: 5,
      unscheduled: 1,
      overdue: 1,
      dueThisWeek: 2,
      dueThisMonth: 3,
      rush: 0,
    });
  });

  it("counts active rush orders", () => {
    const result = aggregate({
      orders: [
        order({ rush: true }),
        order({ rush: true, cancelled: true }),
        order({ rush: false }),
      ],
    });
    expect(result.production.rush).toBe(1);
  });

  it("lists the nearest-due orders first, overdue included, and caps the list", () => {
    const orders = Array.from({ length: UPCOMING_LIMIT + 3 }, (_, i) =>
      order({
        orderNumber: `ORD-${i}`,
        // Descending dates, so a naive pass-through would come out backwards.
        dueDate: `2026-09-${String(20 - i).padStart(2, "0")}`,
      }),
    );

    const { upcoming } = aggregate({ orders }).production;

    expect(upcoming).toHaveLength(UPCOMING_LIMIT);
    expect(upcoming[0].dueDate < upcoming[1].dueDate).toBe(true);
    expect(upcoming.map((o) => o.dueDate)).toEqual(
      [...upcoming.map((o) => o.dueDate)].sort(),
    );
  });

  it("flags an overdue entry and carries the rush marker", () => {
    const { upcoming } = aggregate({
      orders: [order({ dueDate: "2026-01-01", rush: true })],
    }).production;

    expect(upcoming[0]).toMatchObject({ overdue: true, rush: true });
  });
});

describe("aggregateStudioAnalytics — revenue by month", () => {
  it("returns a gapless trailing series ending in the current month", () => {
    const { revenue } = aggregate();
    expect(revenue).toHaveLength(REVENUE_MONTHS);
    expect(revenue[revenue.length - 1].month).toBe("2026-08");
    expect(revenue[0].month).toBe("2025-09");
    expect(revenue.every((m) => m.shopRevenue === 0)).toBe(true);
  });

  it("buckets shop money by the month the order was placed", () => {
    const { revenue } = aggregate({
      shopOrders: [
        shopOrder({ createdTime: "2026-08-02T10:00:00.000Z", total: 40 }),
        shopOrder({ createdTime: "2026-08-20T10:00:00.000Z", total: 60.5 }),
        shopOrder({ createdTime: "2026-07-05T10:00:00.000Z", total: 25 }),
      ],
    });

    const byMonth = new Map(revenue.map((m) => [m.month, m]));
    expect(byMonth.get("2026-08")).toMatchObject({
      shopRevenue: 100.5,
      shopOrders: 2,
    });
    expect(byMonth.get("2026-07")).toMatchObject({
      shopRevenue: 25,
      shopOrders: 1,
    });
  });

  it("excludes cancelled orders and anything outside the window", () => {
    const { revenue } = aggregate({
      shopOrders: [
        shopOrder({ createdTime: "2026-08-02T10:00:00.000Z", total: 40 }),
        shopOrder({
          createdTime: "2026-08-03T10:00:00.000Z",
          total: 999,
          cancelled: true,
        }),
        // Older than the trailing window — must not be folded into month one.
        shopOrder({ createdTime: "2020-01-01T10:00:00.000Z", total: 500 }),
      ],
    });

    const total = revenue.reduce((sum, m) => sum + m.shopRevenue, 0);
    expect(total).toBe(40);
  });

  it("attributes a custom order's invoice total to the month it came in", () => {
    const { revenue } = aggregate({
      orders: [
        order({
          pageId: "page-a",
          createdTime: "2026-06-10T10:00:00.000Z",
          invoicePageId: "inv-a",
        }),
        // No invoice yet: it still counts as an order, but books nothing.
        order({ createdTime: "2026-06-11T10:00:00.000Z" }),
      ],
      invoices: [invoice({ orderPageId: "page-a", finalBalance: 1200 })],
    });

    const june = revenue.find((m) => m.month === "2026-06");
    expect(june).toMatchObject({ customBooked: 1200, customOrders: 2 });
  });

  it("skips a record with no usable creation time rather than misplacing it", () => {
    const { revenue } = aggregate({
      shopOrders: [
        shopOrder({ createdTime: "", total: 99 }),
        shopOrder({ createdTime: "not-a-date", total: 99 }),
      ],
    });
    expect(revenue.every((m) => m.shopRevenue === 0)).toBe(true);
  });
});

describe("aggregateStudioAnalytics — deposits vs balances", () => {
  it("splits collected from outstanding without counting a dollar twice", () => {
    const { payments } = aggregate({
      invoices: [
        invoice({
          finalBalance: 1000,
          depositsPaid: 200,
          depositsUnpaid: 300,
        }),
      ],
    });

    expect(payments).toMatchObject({
      invoicedTotal: 1000,
      depositsCollected: 200,
      depositsOutstanding: 300,
      balancesCollected: 0,
      balancesOutstanding: 500,
      collectedTotal: 200,
      outstandingTotal: 800,
      invoiceCount: 1,
      unpaidInvoiceCount: 1,
    });
    expect(payments.collectedTotal + payments.outstandingTotal).toBe(
      payments.invoicedTotal,
    );
  });

  it("treats a paid balance as settling the invoice outright", () => {
    // The balance stage charges Final Balance minus the deposits actually paid,
    // so an uncollected deposit is swept up by it — nothing is left owing.
    const { payments } = aggregate({
      invoices: [
        invoice({
          finalBalance: 1000,
          depositsPaid: 200,
          depositsUnpaid: 300,
          balancePaid: true,
        }),
      ],
    });

    expect(payments).toMatchObject({
      depositsCollected: 200,
      balancesCollected: 800,
      depositsOutstanding: 0,
      balancesOutstanding: 0,
      collectedTotal: 1000,
      outstandingTotal: 0,
      unpaidInvoiceCount: 0,
    });
  });

  it("ignores an invoice on a cancelled order", () => {
    const { payments } = aggregate({
      orders: [order({ pageId: "page-x", cancelled: true })],
      invoices: [
        invoice({
          orderPageId: "page-x",
          finalBalance: 900,
          depositsUnpaid: 900,
        }),
      ],
    });

    expect(payments.invoiceCount).toBe(0);
    expect(payments.outstandingTotal).toBe(0);
  });

  it("still counts an invoice whose order relation is empty", () => {
    const { payments } = aggregate({
      invoices: [invoice({ finalBalance: 500, depositsPaid: 500 })],
    });
    expect(payments.invoiceCount).toBe(1);
    expect(payments.depositsCollected).toBe(500);
  });

  it("rounds money to cents", () => {
    const { payments } = aggregate({
      invoices: [
        invoice({ finalBalance: 0.1, depositsPaid: 0.1, balancePaid: true }),
        invoice({ finalBalance: 0.2, depositsPaid: 0.2, balancePaid: true }),
      ],
    });
    expect(payments.depositsCollected).toBe(0.3);
  });
});

describe("aggregateStudioAnalytics — best sellers", () => {
  const names = new Map([
    ["inv-1", "Bow Soaker"],
    ["inv-2", "Blade Towel"],
  ]);

  it("counts one order once per piece and sorts by orders", () => {
    const { topItems } = aggregate({
      itemNames: names,
      shopOrders: [
        // The same piece twice on one order is still one order for it.
        shopOrder({ itemIds: ["inv-1", "inv-1", "inv-2"] }),
        shopOrder({ itemIds: ["inv-1"] }),
      ],
    });

    expect(topItems).toEqual([
      { name: "Bow Soaker", orders: 2 },
      { name: "Blade Towel", orders: 1 },
    ]);
  });

  it("ignores cancelled orders and ids with no live inventory row", () => {
    const { topItems } = aggregate({
      itemNames: names,
      shopOrders: [
        shopOrder({ itemIds: ["inv-1", "inv-archived"] }),
        shopOrder({ itemIds: ["inv-2"], cancelled: true }),
      ],
    });

    expect(topItems).toEqual([{ name: "Bow Soaker", orders: 1 }]);
  });

  it("comes back empty when no order carries an inventory link", () => {
    const { topItems } = aggregate({
      itemNames: names,
      shopOrders: [shopOrder({ itemIds: [] })],
    });
    expect(topItems).toEqual([]);
  });

  it("caps the list", () => {
    const ids = Array.from({ length: TOP_ITEMS_LIMIT + 4 }, (_, i) => `i-${i}`);
    const { topItems } = aggregate({
      itemNames: new Map(ids.map((id) => [id, `Piece ${id}`])),
      shopOrders: ids.map((id) => shopOrder({ itemIds: [id] })),
    });
    expect(topItems).toHaveLength(TOP_ITEMS_LIMIT);
  });
});

describe("aggregateStudioAnalytics — envelope", () => {
  it("stamps the instant the figures were computed", () => {
    expect(aggregate().generatedAt).toBe(NOW.toISOString());
  });

  it("handles an empty studio without dividing by zero", () => {
    const result = aggregate();
    expect(result.customOrders.total).toBe(0);
    expect(result.production.activeOrders).toBe(0);
    expect(result.payments.outstandingTotal).toBe(0);
    expect(result.topItems).toEqual([]);
  });
});
