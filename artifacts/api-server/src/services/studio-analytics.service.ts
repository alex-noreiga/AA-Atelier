// The internal studio dashboard's figures — the atelier looking at its own book
// of work, rather than a customer looking at their order.
//
// Everything here is derived from data the app already keeps in Notion; nothing
// new is written and no number is invented. Three shaping decisions are worth
// knowing before changing anything:
//
//  1. **Positional, never by name.** Which stage counts as finished is the
//     shared `orderLifecycleState` rule (the last option in the live list), so
//     renaming or reordering stages in Notion never silently miscounts a
//     pipeline. The same rule classifies shop orders against their live
//     fulfilment statuses.
//
//  2. **Shop revenue and custom bookings are reported side by side, not
//     summed.** A shop order records what was collected and when (Stripe paid
//     it, Notion stamped the page). A custom order's payments carry no dates at
//     all — the invoice holds a paid *checkbox* per stage — so the only honest
//     monthly figure for bespoke work is what was *booked* (the invoice's Final
//     Balance, attributed to the month the order was placed). Adding those two
//     together would read as revenue and be wrong; a real per-payment ledger is
//     the roadmap's "move real invoicing to a finance tool".
//
//  3. **The aggregation is a pure function.** `aggregateStudioAnalytics` takes
//     records and a clock and returns the response, so every rule above is unit
//     testable without Notion; the exported use-case just fetches, caches, and
//     calls it.

import { listOrdersForAnalytics } from "../lib/notion/orders.repository.js";
import type { OrderAnalyticsRecord } from "../lib/notion/orders.schema.js";
import {
  listShopOrdersForAnalytics,
  type ShopOrderAnalyticsRecord,
} from "../lib/notion/shop-orders.repository.js";
import { listInvoicesForAnalytics } from "../lib/notion/invoice.repository.js";
import type { InvoiceAnalyticsRecord } from "../lib/notion/invoice.schema.js";
import { listVariants } from "../lib/notion/products.repository.js";
import { dateInZone, addCalendarDays } from "../lib/appointments/time.js";
import { appointmentTimezone } from "../lib/appointments/settings.js";
import { orderLifecycleState } from "./delivery.js";
import { logger } from "../lib/logger.js";

/** How many trailing months the revenue series covers (this month included). */
export const REVENUE_MONTHS = 12;
/** How many best sellers the dashboard lists. */
export const TOP_ITEMS_LIMIT = 8;
/** How many nearest-due orders the production panel lists. */
export const UPCOMING_LIMIT = 8;
/** Windows the production load is measured over, in days from today. */
const WEEK_DAYS = 7;
const MONTH_DAYS = 30;
/** How long an aggregation is reused. The scans are the most expensive read in
 * the app, and a dashboard gets refreshed; a minute matches the TTL every other
 * live Notion read here uses. */
const CACHE_TTL_MS = 60_000;

// --- Result shapes (mirroring the `StudioAnalytics` contract) ---

export interface StudioStageCount {
  stage: string;
  count: number;
}

export interface StudioPipeline {
  total: number;
  active: number;
  completed: number;
  cancelled: number;
  stages: StudioStageCount[];
}

export interface StudioScheduledOrder {
  orderNumber: string;
  orderName: string;
  stage: string;
  dueDate: string;
  overdue: boolean;
  rush?: boolean;
}

export interface StudioProductionLoad {
  activeOrders: number;
  scheduled: number;
  unscheduled: number;
  overdue: number;
  dueThisWeek: number;
  dueThisMonth: number;
  rush: number;
  upcoming: StudioScheduledOrder[];
}

export interface StudioRevenueMonth {
  month: string;
  shopRevenue: number;
  shopOrders: number;
  customBooked: number;
  customOrders: number;
}

export interface StudioPaymentTotals {
  invoicedTotal: number;
  collectedTotal: number;
  outstandingTotal: number;
  depositsCollected: number;
  depositsOutstanding: number;
  balancesCollected: number;
  balancesOutstanding: number;
  invoiceCount: number;
  unpaidInvoiceCount: number;
}

export interface StudioTopItem {
  name: string;
  orders: number;
}

export interface StudioAnalyticsResult {
  generatedAt: string;
  customOrders: StudioPipeline;
  shopOrders: StudioPipeline;
  production: StudioProductionLoad;
  revenue: StudioRevenueMonth[];
  payments: StudioPaymentTotals;
  topItems: StudioTopItem[];
}

/** Everything the aggregation reads, so it stays pure and testable. */
export interface StudioAnalyticsInput {
  orders: OrderAnalyticsRecord[];
  /** The live custom-order Stage list, in order. */
  stages: string[];
  shopOrders: ShopOrderAnalyticsRecord[];
  /** The live shop fulfilment Status list, in order. */
  shopStatuses: string[];
  invoices: InvoiceAnalyticsRecord[];
  /** Inventory page id → piece name, for the best-seller list. */
  itemNames: Map<string, string>;
  /** The instant the figures are computed for. */
  now: Date;
  /** The studio's IANA timezone — months and "today" are read in it, so an
   * order placed at 9pm on the 31st lands in the month the atelier worked it. */
  timeZone: string;
}

// --- Small date helpers (calendar months, no date library) ---

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

/** The `YYYY-MM` an instant falls in, read in the studio's timezone. */
function monthOf(instant: Date, timeZone: string): string {
  return dateInZone(instant, timeZone).slice(0, 7);
}

/** Shift a `YYYY-MM` key by whole months (negative shifts backwards). */
function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, index - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}`;
}

/** Parse a Notion timestamp, or null when it's missing/unparseable (a page
 * without a usable creation time can't be placed in a month, so it's skipped
 * from the series rather than dropped into the wrong one). */
function parseInstant(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// --- The aggregation ---

/**
 * Count a set of orders across their live workflow list.
 *
 * `list` is the superset the per-stage buckets are counted over; a record's own
 * `pipeline` (a custom order's service pipeline) is what decides whether it is
 * finished, so a repair counts as completed at the end of its own sequence
 * rather than only at the end of the commission's. Shop orders have one
 * fulfilment workflow and pass none, falling back to `list`.
 */
function buildPipeline(
  records: Array<{ cancelled: boolean; stage: string; pipeline?: string[] }>,
  list: string[],
): StudioPipeline {
  const counts = new Map<string, number>(list.map((stage) => [stage, 0]));
  let active = 0;
  let completed = 0;
  let cancelled = 0;

  for (const record of records) {
    const state = orderLifecycleState(
      record.cancelled,
      record.stage,
      record.pipeline ?? list,
    );
    if (state === "cancelled") {
      cancelled += 1;
      continue;
    }
    if (state === "completed") {
      completed += 1;
      continue;
    }
    active += 1;
    // An active order whose stage isn't in the live list (blank, or an option
    // the atelier deleted) still counts as active; it just has no bucket.
    const bucket = counts.get(record.stage);
    if (bucket !== undefined) counts.set(record.stage, bucket + 1);
  }

  return {
    total: records.length,
    active,
    completed,
    cancelled,
    stages: list.map((stage) => ({ stage, count: counts.get(stage) ?? 0 })),
  };
}

/** The making-side workload: active custom orders against their due dates. */
function buildProductionLoad(
  activeOrders: OrderAnalyticsRecord[],
  today: string,
): StudioProductionLoad {
  const weekCutoff = addCalendarDays(today, WEEK_DAYS - 1);
  const monthCutoff = addCalendarDays(today, MONTH_DAYS - 1);

  let scheduled = 0;
  let overdue = 0;
  let dueThisWeek = 0;
  let dueThisMonth = 0;
  let rush = 0;
  const dated: StudioScheduledOrder[] = [];

  for (const order of activeOrders) {
    if (order.rush) rush += 1;
    const dueDate = order.dueDate;
    if (!dueDate) continue;
    scheduled += 1;
    // ISO dates sort lexicographically, so string comparison is calendar order.
    const isOverdue = dueDate < today;
    if (isOverdue) overdue += 1;
    if (!isOverdue && dueDate <= weekCutoff) dueThisWeek += 1;
    if (!isOverdue && dueDate <= monthCutoff) dueThisMonth += 1;
    dated.push({
      orderNumber: order.orderNumber,
      orderName: order.orderName,
      stage: order.stage,
      dueDate,
      overdue: isOverdue,
      ...(order.rush ? { rush: true } : {}),
    });
  }

  dated.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return {
    activeOrders: activeOrders.length,
    scheduled,
    unscheduled: activeOrders.length - scheduled,
    overdue,
    dueThisWeek,
    dueThisMonth,
    rush,
    upcoming: dated.slice(0, UPCOMING_LIMIT),
  };
}

/** The trailing revenue series — shop money collected beside custom work
 * booked, one entry per month with no gaps (see decision 2 in the header). */
function buildRevenue(
  input: StudioAnalyticsInput,
  invoiceByOrderPage: Map<string, InvoiceAnalyticsRecord>,
): StudioRevenueMonth[] {
  const thisMonth = monthOf(input.now, input.timeZone);
  const months = new Map<string, StudioRevenueMonth>();
  for (let back = REVENUE_MONTHS - 1; back >= 0; back -= 1) {
    const month = shiftMonth(thisMonth, -back);
    months.set(month, {
      month,
      shopRevenue: 0,
      shopOrders: 0,
      customBooked: 0,
      customOrders: 0,
    });
  }

  for (const order of input.shopOrders) {
    if (order.cancelled) continue;
    const placed = parseInstant(order.createdTime);
    if (!placed) continue;
    const entry = months.get(monthOf(placed, input.timeZone));
    if (!entry) continue; // outside the window
    entry.shopOrders += 1;
    entry.shopRevenue += order.total ?? 0;
  }

  for (const order of input.orders) {
    if (order.cancelled) continue;
    const placed = parseInstant(order.createdTime);
    if (!placed) continue;
    const entry = months.get(monthOf(placed, input.timeZone));
    if (!entry) continue;
    entry.customOrders += 1;
    const invoice = invoiceByOrderPage.get(order.pageId);
    entry.customBooked += invoice?.finalBalance ?? 0;
  }

  return [...months.values()];
}

/**
 * Deposits against balances across every invoice on a live order.
 *
 * The split is built so the two outstanding figures add up to the total still
 * out, with no overlap: an unpaid deposit is counted once as a deposit due, and
 * the balance figure is what's left *beyond* every deposit scheduled against
 * the invoice. Paying the balance settles the invoice outright — the app
 * charges `Final Balance − deposits paid` at that stage — so a paid balance
 * leaves nothing outstanding even if a deposit was never collected.
 */
function buildPayments(
  invoices: InvoiceAnalyticsRecord[],
  cancelledOrderPages: Set<string>,
): StudioPaymentTotals {
  let invoicedTotal = 0;
  let depositsCollected = 0;
  let depositsOutstanding = 0;
  let balancesCollected = 0;
  let balancesOutstanding = 0;
  let invoiceCount = 0;
  let unpaidInvoiceCount = 0;

  for (const invoice of invoices) {
    // An invoice on a cancelled order is refunded, not owed. One whose `Order`
    // relation is empty or points somewhere unknown still counts — money on the
    // books is money on the books.
    if (invoice.orderPageId && cancelledOrderPages.has(invoice.orderPageId)) {
      continue;
    }
    invoiceCount += 1;
    const total = invoice.finalBalance ?? 0;
    invoicedTotal += total;
    depositsCollected += invoice.depositsPaid;

    if (invoice.balancePaid) {
      balancesCollected += Math.max(0, total - invoice.depositsPaid);
      continue;
    }

    const beyondDeposits = Math.max(
      0,
      total - invoice.depositsPaid - invoice.depositsUnpaid,
    );
    depositsOutstanding += invoice.depositsUnpaid;
    balancesOutstanding += beyondDeposits;
    if (invoice.depositsUnpaid > 0 || beyondDeposits > 0) {
      unpaidInvoiceCount += 1;
    }
  }

  return {
    invoicedTotal: round2(invoicedTotal),
    collectedTotal: round2(depositsCollected + balancesCollected),
    outstandingTotal: round2(depositsOutstanding + balancesOutstanding),
    depositsCollected: round2(depositsCollected),
    depositsOutstanding: round2(depositsOutstanding),
    balancesCollected: round2(balancesCollected),
    balancesOutstanding: round2(balancesOutstanding),
    invoiceCount,
    unpaidInvoiceCount,
  };
}

/** The shop's best sellers, by orders containing each piece. Ids that don't
 * resolve to a live inventory row (archived/unpublished) are dropped rather
 * than shown as a bare page id. */
function buildTopItems(
  shopOrders: ShopOrderAnalyticsRecord[],
  itemNames: Map<string, string>,
): StudioTopItem[] {
  const counts = new Map<string, number>();
  for (const order of shopOrders) {
    if (order.cancelled) continue;
    // Dedupe within an order: the relation records which pieces were bought,
    // not how many of each, so one order counts once per piece.
    for (const id of new Set(order.itemIds)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  const items: StudioTopItem[] = [];
  for (const [id, orders] of counts) {
    const name = itemNames.get(id);
    if (!name) continue;
    items.push({ name, orders });
  }

  items.sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name));
  return items.slice(0, TOP_ITEMS_LIMIT);
}

/** Money to cents, so a float sum doesn't surface as 1234.5600000000002. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Aggregate the studio's figures from the raw records. Pure — see the header. */
export function aggregateStudioAnalytics(
  input: StudioAnalyticsInput,
): StudioAnalyticsResult {
  const today = dateInZone(input.now, input.timeZone);

  const invoiceByOrderPage = new Map<string, InvoiceAnalyticsRecord>();
  for (const invoice of input.invoices) {
    if (invoice.orderPageId)
      invoiceByOrderPage.set(invoice.orderPageId, invoice);
  }

  const cancelledOrderPages = new Set(
    input.orders.filter((o) => o.cancelled).map((o) => o.pageId),
  );

  const activeOrders = input.orders.filter(
    (order) =>
      orderLifecycleState(
        order.cancelled,
        order.stage,
        order.pipeline ?? input.stages,
      ) === "active",
  );

  return {
    generatedAt: input.now.toISOString(),
    customOrders: buildPipeline(
      input.orders.map((o) => ({
        cancelled: o.cancelled,
        stage: o.stage,
        ...(o.pipeline !== undefined ? { pipeline: o.pipeline } : {}),
      })),
      input.stages,
    ),
    shopOrders: buildPipeline(
      input.shopOrders.map((o) => ({
        cancelled: o.cancelled,
        stage: o.status,
      })),
      input.shopStatuses,
    ),
    production: buildProductionLoad(activeOrders, today),
    revenue: buildRevenue(input, invoiceByOrderPage),
    payments: buildPayments(input.invoices, cancelledOrderPages),
    topItems: buildTopItems(input.shopOrders, input.itemNames),
  };
}

// --- The use-case ---

let cached: { result: StudioAnalyticsResult; fetchedAt: number } | null = null;

/** Drop the cached aggregation (tests; also the seam if a manual refresh is
 * ever wanted). */
export function __resetStudioAnalyticsCache(): void {
  cached = null;
}

/**
 * The studio dashboard's figures, read live from Notion and cached briefly.
 *
 * The three scans and the inventory read run together — they're independent.
 * Only the inventory read degrades on failure (to an empty best-seller list,
 * which the contract already allows): the orders, shop orders, and invoices ARE
 * the dashboard, and quietly rendering zeroes for them would be a lie the
 * atelier can't see. A failure there surfaces as a 500, which the alert mailer
 * reports like any other.
 */
export async function getStudioAnalytics(): Promise<StudioAnalyticsResult> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.result;
  }

  const [orders, shop, invoices, variants] = await Promise.all([
    listOrdersForAnalytics(),
    listShopOrdersForAnalytics(),
    listInvoicesForAnalytics(),
    listVariants().catch((err) => {
      logger.warn(
        { err },
        "Studio analytics: could not read inventory; best sellers will be empty",
      );
      return [];
    }),
  ]);

  const result = aggregateStudioAnalytics({
    orders: orders.orders,
    stages: orders.stages,
    shopOrders: shop.orders,
    shopStatuses: shop.statuses,
    invoices,
    itemNames: new Map(variants.map((variant) => [variant.id, variant.name])),
    now: new Date(),
    // The studio's own timezone. It's configured once, as the zone the
    // atelier's booking hours are kept in, and reused here so "this month" and
    // "overdue" mean what the studio means by them.
    timeZone: appointmentTimezone(),
  });

  cached = { result, fetchedAt: Date.now() };
  return result;
}
