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
import {
  summarizeConsignment,
  type ConsignmentOverview,
} from "../../src/services/consignment.service.js";
import type { PaymentRecord } from "../../src/lib/db/payments.repository.js";
import type { InvoiceLineAnalyticsRecord } from "../../src/lib/notion/invoice.schema.js";

/** A shelf with nothing on it, wired up. Built through the real summarizer so
 * the fixture can't drift from the shape the service actually returns. */
function emptyConsignment(): ConsignmentOverview {
  return { ...summarizeConsignment([]), configured: true };
}

const STAGES = ["Consultation", "Design", "Cutting/Pinning", "Delivered"];
const SHOP_STATUSES = ["Payment Confirmed", "Shipped", "Delivered"];
const SHOP_CHANNELS = ["Etsy", "Online Store", "Skate Shop"];
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
    // Blank by default, so the fixture is a plainly hand-filed row and a test
    // that cares about attribution has to say which channel it means.
    orderDate: "",
    channel: "",
    sessionId: "",
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

/** One invoice line, as the analytics scan reads it. */
function line(
  invoicePageId: string,
  amount: number,
  type = "Material",
): InvoiceLineAnalyticsRecord {
  return { invoicePageId, type, amount };
}

/** One ledger row. Amounts are SIGNED cents, as the table stores them. */
function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  seq += 1;
  return {
    id: `payment-${seq}`,
    orderNumber: "ORD-000002",
    orderKind: "custom",
    stage: "first_deposit",
    kind: "charge",
    amountCents: 25000,
    currency: "usd",
    method: "stripe",
    paidAt: new Date("2026-08-14T17:00:00.000Z"),
    externalId: "",
    paymentIntentId: "",
    note: "",
    recordedBy: "",
    ...overrides,
  };
}

/** The ledger source, with rows. */
function ledger(rows: PaymentRecord[] = []) {
  return { configured: true, unavailable: false, rows };
}

function aggregate(input: Partial<StudioAnalyticsInput> = {}) {
  return aggregateStudioAnalytics({
    orders: [],
    stages: STAGES,
    shopOrders: [],
    shopStatuses: SHOP_STATUSES,
    shopChannels: SHOP_CHANNELS,
    consignment: emptyConsignment(),
    invoices: [],
    invoiceLines: { rows: [], complete: true },
    // Default: a configured ledger holding nothing, which is what an install
    // that hasn't been backfilled looks like. Tests that care supply rows.
    payments: { configured: true, unavailable: false, rows: [] },
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

describe("aggregateStudioAnalytics — sales channels", () => {
  it("lays out every live channel, including ones with no trade", () => {
    const { channels } = aggregate({
      shopOrders: [
        shopOrder({ channel: "Etsy", total: 60, orderDate: "2026-08-02" }),
        shopOrder({ channel: "Etsy", total: 40, orderDate: "2026-08-03" }),
        shopOrder({
          channel: "Online Store",
          total: 25,
          orderDate: "2026-08-04",
        }),
      ],
    });

    // Skate Shop sold nothing and is still listed — a channel that went quiet
    // must be readable as a nought, not by its absence.
    expect(channels).toEqual([
      { channel: "Etsy", orders: 2, revenue: 100 },
      { channel: "Online Store", orders: 1, revenue: 25 },
      { channel: "Skate Shop", orders: 0, revenue: 0 },
    ]);
  });

  it("credits an untagged order the app took to the online store", () => {
    // Every order placed before the channel stamp shipped is in this state:
    // no `Sales Channel`, but a Stripe session that proves the app wrote it.
    const { channels } = aggregate({
      shopOrders: [
        shopOrder({
          channel: "",
          sessionId: "cs_test_1",
          total: 30,
          orderDate: "2026-08-05",
        }),
      ],
    });

    expect(channels.find((c) => c.channel === "Online Store")).toEqual({
      channel: "Online Store",
      orders: 1,
      revenue: 30,
    });
    expect(channels.some((c) => c.channel === "")).toBe(false);
  });

  it("reports a hand-filed untagged order as unattributed, last", () => {
    const { channels } = aggregate({
      shopOrders: [
        shopOrder({
          channel: "",
          sessionId: "",
          total: 15,
          orderDate: "2026-08-06",
        }),
      ],
    });

    expect(channels[channels.length - 1]).toEqual({
      channel: "",
      orders: 1,
      revenue: 15,
    });
  });

  it("keeps a channel the atelier has since removed from the option list", () => {
    const { channels } = aggregate({
      shopOrders: [
        shopOrder({
          channel: "Craft Fair",
          total: 80,
          orderDate: "2026-08-07",
        }),
      ],
    });

    // Money that was taken was taken, whatever the list says today — it follows
    // the live options rather than being dropped.
    expect(channels.map((c) => c.channel)).toEqual([
      "Etsy",
      "Online Store",
      "Skate Shop",
      "Craft Fair",
    ]);
    expect(channels.find((c) => c.channel === "Craft Fair")?.revenue).toBe(80);
  });

  it("excludes cancelled orders and anything outside the window", () => {
    const { channels } = aggregate({
      shopOrders: [
        shopOrder({
          channel: "Etsy",
          total: 50,
          orderDate: "2026-08-02",
          cancelled: true,
        }),
        // Thirteen months back — outside the trailing window.
        shopOrder({ channel: "Etsy", total: 90, orderDate: "2025-07-02" }),
      ],
    });

    expect(channels.find((c) => c.channel === "Etsy")).toEqual({
      channel: "Etsy",
      orders: 0,
      revenue: 0,
    });
  });
});

describe("aggregateStudioAnalytics — when an order happened", () => {
  it("attributes a hand-filed order to its Order Date, not its row's age", () => {
    // The Etsy receipt sold in June and was typed up in August. Dating it by
    // the Notion page would report another shop's June trade as August's.
    const { revenue } = aggregate({
      shopOrders: [
        shopOrder({
          total: 75,
          orderDate: "2026-06-11",
          createdTime: "2026-08-18T09:00:00.000Z",
        }),
      ],
    });

    const june = revenue.find((m) => m.month === "2026-06");
    const august = revenue.find((m) => m.month === "2026-08");
    expect(june?.shopRevenue).toBe(75);
    expect(august?.shopRevenue).toBe(0);
  });

  it("takes a date-only value as written, without pushing it through a zone", () => {
    // Parsed as an instant and read in Chicago, 2026-09-01 lands on August 31 —
    // a sale silently moved into the previous month's figures.
    const { revenue } = aggregate({
      timeZone: "America/Chicago",
      now: new Date("2026-09-15T12:00:00.000Z"),
      shopOrders: [shopOrder({ total: 50, orderDate: "2026-09-01" })],
    });

    expect(revenue.find((m) => m.month === "2026-09")?.shopRevenue).toBe(50);
    expect(revenue.find((m) => m.month === "2026-08")?.shopRevenue).toBe(0);
  });

  it("falls back to the row's creation time when no Order Date is set", () => {
    const { revenue } = aggregate({
      shopOrders: [
        shopOrder({
          total: 20,
          orderDate: "",
          createdTime: "2026-07-04T10:00:00.000Z",
        }),
      ],
    });

    expect(revenue.find((m) => m.month === "2026-07")?.shopRevenue).toBe(20);
  });

  it("converts a full instant through the studio's timezone", () => {
    // 9pm on August 31 in Chicago is September 1 in UTC. The atelier worked it
    // in August, so it belongs to August.
    const { revenue } = aggregate({
      timeZone: "America/Chicago",
      shopOrders: [
        shopOrder({ total: 35, orderDate: "2026-09-01T02:00:00.000Z" }),
      ],
    });

    expect(revenue.find((m) => m.month === "2026-08")?.shopRevenue).toBe(35);
  });
});

describe("aggregateStudioAnalytics — best-seller coverage", () => {
  it("counts the orders the item list cannot see", () => {
    const { topItemCoverage } = aggregate({
      itemNames: new Map([["inv-1", "Bow Soaker"]]),
      shopOrders: [
        shopOrder({ itemIds: ["inv-1"], orderDate: "2026-08-02" }),
        shopOrder({ itemIds: [], orderDate: "2026-08-03" }),
        shopOrder({ itemIds: [], orderDate: "2026-08-04" }),
        // Cancelled and out-of-window orders are neither counted nor missed.
        shopOrder({ itemIds: [], orderDate: "2026-08-05", cancelled: true }),
        shopOrder({ itemIds: [], orderDate: "2024-08-05" }),
      ],
    });

    expect(topItemCoverage).toEqual({ counted: 1, unlinked: 2 });
  });
});

describe("aggregateStudioAnalytics — consignment", () => {
  it("names the pieces on the shelf and passes the totals through", () => {
    const { consignment } = aggregate({
      itemNames: new Map([["inv-1", "Bow Soaker"]]),
      consignment: {
        ...summarizeConsignment([]),
        configured: true,
        atShopUnits: 4,
        items: [
          { itemId: "inv-1", atShop: 4, sold: 2 },
          // An id with no live inventory row: dropped from the list, but its
          // units stay in the totals above, which are the authority.
          { itemId: "inv-gone", atShop: 1, sold: 0 },
        ],
      },
    });

    expect(consignment.atShopUnits).toBe(4);
    expect(consignment.items).toEqual([
      { name: "Bow Soaker", atShop: 4, sold: 2 },
    ]);
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

describe("aggregateStudioAnalytics — collected revenue from the ledger", () => {
  it("buckets a payment by the month the MONEY moved, not the order's", () => {
    // The whole point of the ledger. A commission placed in June and paid in
    // August is June's booked figure and August's collected one.
    const { revenue } = aggregate({
      payments: ledger([
        payment({ paidAt: new Date("2026-08-14T17:00:00.000Z") }),
        payment({
          amountCents: 100000,
          paidAt: new Date("2026-07-02T17:00:00.000Z"),
        }),
      ]),
    });

    const byMonth = new Map(revenue.map((m) => [m.month, m]));
    expect(byMonth.get("2026-08")?.customCollected).toBe(250);
    expect(byMonth.get("2026-07")?.customCollected).toBe(1000);
  });

  it("nets refunds out of the month they were issued in", () => {
    // A refund is a negative row, so a refunded order stops counting as
    // collected — which the Notion paid-checkbox never did.
    const { revenue } = aggregate({
      payments: ledger([
        payment({ amountCents: 25000 }),
        payment({ kind: "refund", amountCents: -10000 }),
      ]),
    });

    const august = revenue.find((m) => m.month === "2026-08");
    expect(august?.customCollected).toBe(150);
  });

  it("reports a month that gave back more than it took as negative", () => {
    // Honest rather than clamped: flooring it at zero would hide the refund
    // somewhere nobody could find it.
    const { revenue } = aggregate({
      payments: ledger([payment({ kind: "refund", amountCents: -10000 })]),
    });

    expect(revenue.find((m) => m.month === "2026-08")?.customCollected).toBe(
      -100,
    );
  });

  it("ignores SHOP rows — shopRevenue already counts that money", () => {
    // Drawing the same number from two places is how the two come to disagree.
    const { revenue } = aggregate({
      payments: ledger([
        payment({ orderKind: "shop", orderNumber: "SHP-1", amountCents: 8800 }),
      ]),
    });

    expect(revenue.find((m) => m.month === "2026-08")?.customCollected).toBe(0);
  });

  it("ignores a payment outside the reporting window", () => {
    const { revenue } = aggregate({
      payments: ledger([
        payment({ paidAt: new Date("2020-01-01T12:00:00.000Z") }),
      ]),
    });

    expect(revenue.every((m) => m.customCollected === 0)).toBe(true);
  });

  it("keeps booked and collected as separate answers about one order", () => {
    const { revenue } = aggregate({
      orders: [
        order({ pageId: "page-a", createdTime: "2026-06-10T10:00:00.000Z" }),
      ],
      invoices: [invoice({ orderPageId: "page-a", finalBalance: 1200 })],
      payments: ledger([
        payment({ paidAt: new Date("2026-08-01T17:00:00.000Z") }),
      ]),
    });

    const byMonth = new Map(revenue.map((m) => [m.month, m]));
    expect(byMonth.get("2026-06")?.customBooked).toBe(1200);
    expect(byMonth.get("2026-06")?.customCollected).toBe(0);
    expect(byMonth.get("2026-08")?.customBooked).toBe(0);
    expect(byMonth.get("2026-08")?.customCollected).toBe(250);
  });

  it("settles float noise so a sum of cents reads as dollars", () => {
    const { revenue } = aggregate({
      payments: ledger([
        payment({ amountCents: 1 }),
        payment({ amountCents: 2 }),
      ]),
    });

    expect(revenue.find((m) => m.month === "2026-08")?.customCollected).toBe(
      0.03,
    );
  });
});

describe("aggregateStudioAnalytics — what the ledger could tell us", () => {
  it("reports an unconfigured ledger, so a nought can't read as no takings", () => {
    const { paymentLedger } = aggregate({
      payments: { configured: false, unavailable: false, rows: [] },
    });

    expect(paymentLedger).toEqual({ configured: false, payments: 0 });
  });

  it("reports an unreadable ledger as unavailable, not as empty", () => {
    const { paymentLedger } = aggregate({
      payments: { configured: true, unavailable: true, rows: [] },
    });

    expect(paymentLedger).toMatchObject({
      configured: true,
      unavailable: true,
      payments: 0,
    });
  });

  it("names the earliest month holding a payment — the backfill's watermark", () => {
    // Months before this show 0 because nothing is recorded there, which is what
    // an install that hasn't been backfilled looks like.
    const { paymentLedger } = aggregate({
      payments: ledger([
        payment({ paidAt: new Date("2026-08-14T17:00:00.000Z") }),
        payment({ paidAt: new Date("2026-06-02T17:00:00.000Z") }),
      ]),
    });

    expect(paymentLedger).toEqual({
      configured: true,
      payments: 2,
      recordedFrom: "2026-06",
    });
  });

  it("omits recordedFrom when the window holds nothing", () => {
    const { paymentLedger } = aggregate({ payments: ledger([]) });

    expect(paymentLedger).toEqual({ configured: true, payments: 0 });
  });
});

describe("aggregateStudioAnalytics — what an invoice is worth", () => {
  it("values an invoice from its LINES, not from Notion's Final Balance", () => {
    // The two used to be derived separately and agreed only by convention. A
    // Final Balance that disagrees with the lines now loses to the lines, which
    // is what the customer is actually shown.
    const { revenue, payments } = aggregate({
      orders: [
        order({ pageId: "page-a", createdTime: "2026-08-04T10:00:00.000Z" }),
      ],
      invoices: [
        invoice({
          pageId: "inv-a",
          orderPageId: "page-a",
          finalBalance: 9999,
        }),
      ],
      invoiceLines: {
        rows: [line("inv-a", 400), line("inv-a", 350, "Labor")],
        complete: true,
      },
    });

    expect(revenue.find((m) => m.month === "2026-08")?.customBooked).toBe(750);
    expect(payments.invoicedTotal).toBe(750);
  });

  it("excludes a Deposit line, which is a credit and not a charge", () => {
    // Notion's Final Balance applies no such filter, so a Deposit line would
    // inflate the atelier's view while the customer's stayed correct. This is
    // the divergence the shared rule closes.
    const { payments } = aggregate({
      invoices: [invoice({ pageId: "inv-a", finalBalance: 900 })],
      invoiceLines: {
        rows: [line("inv-a", 700), line("inv-a", 200, "Deposit")],
        complete: true,
      },
    });

    expect(payments.invoicedTotal).toBe(700);
  });

  it("falls back to Final Balance for an invoice with no lines at all", () => {
    // Which is what a failed or truncated line scan looks like: the previous
    // behaviour, degraded rather than a page of noughts.
    const { payments } = aggregate({
      invoices: [invoice({ pageId: "inv-a", finalBalance: 900 })],
      invoiceLines: { rows: [], complete: true },
    });

    expect(payments.invoicedTotal).toBe(900);
  });

  it("reads 0 for an invoice with neither lines nor a Final Balance", () => {
    const { payments } = aggregate({
      invoices: [invoice({ pageId: "inv-a" })],
      invoiceLines: { rows: [], complete: true },
    });

    expect(payments.invoicedTotal).toBe(0);
  });

  it("falls the WHOLE pass back to Final Balance on a truncated scan", () => {
    // The rows are grouped by invoice, so a cut-short read doesn't drop an
    // invoice, it halves one. An invoice quietly worth less than it is would be
    // the worst way for this to be wrong, so a partial read is treated as no
    // read at all — the previous behaviour, degraded rather than incorrect.
    const { payments } = aggregate({
      invoices: [invoice({ pageId: "inv-a", finalBalance: 900 })],
      invoiceLines: { rows: [line("inv-a", 100)], complete: false },
    });

    expect(payments.invoicedTotal).toBe(900);
  });

  it("does not let one invoice's lines reach another", () => {
    const { payments } = aggregate({
      invoices: [
        invoice({ pageId: "inv-a", finalBalance: 111 }),
        invoice({ pageId: "inv-b", finalBalance: 222 }),
      ],
      invoiceLines: {
        rows: [line("inv-a", 500), line("inv-b", 40)],
        complete: true,
      },
    });

    expect(payments.invoicedTotal).toBe(540);
  });

  it("skips an orphaned line rather than guessing which invoice it belongs to", () => {
    // Attributing it would put money on an order that never charged it.
    const { payments } = aggregate({
      invoices: [invoice({ pageId: "inv-a" })],
      invoiceLines: {
        rows: [line("inv-a", 100), line("", 5000)],
        complete: true,
      },
    });

    expect(payments.invoicedTotal).toBe(100);
  });

  it("nets the derived value against deposits when splitting the balance", () => {
    // The value flows into the outstanding split too, not just the headline.
    const { payments } = aggregate({
      invoices: [
        invoice({
          pageId: "inv-a",
          finalBalance: 9999,
          depositsPaid: 200,
          depositsUnpaid: 100,
        }),
      ],
      invoiceLines: { rows: [line("inv-a", 800)], complete: true },
    });

    expect(payments.invoicedTotal).toBe(800);
    expect(payments.depositsCollected).toBe(200);
    expect(payments.depositsOutstanding).toBe(100);
    expect(payments.balancesOutstanding).toBe(500);
  });
});
