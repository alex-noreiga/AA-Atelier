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
//  3. **Every channel the studio sells through is counted, and each one is
//     named.** The atelier has always filed Etsy receipts, skate-shop sales and
//     word-of-mouth orders into the same Notion database the website writes to,
//     so a channel-blind total reported all of it as if the website had taken
//     the money. The orders now carry a `Sales Channel`, the figures break down
//     by it, and an order carrying none is reported AS unattributed rather than
//     folded into a channel it might not belong to. The consignment shelf is
//     the one channel with no orders at all, and has a reader of its own.
//
//  4. **The aggregation is a pure function.** `aggregateStudioAnalytics` takes
//     records and a clock and returns the response, so every rule above is unit
//     testable without Notion; the exported use-case just fetches, caches, and
//     calls it.

import { listOrdersForAnalytics } from "../lib/notion/orders.repository.js";
import type { OrderAnalyticsRecord } from "../lib/notion/orders.schema.js";
import {
  listShopOrdersForAnalytics,
  type ShopOrderAnalyticsRecord,
} from "../lib/notion/shop-orders.repository.js";
import { SHOP_ORDER_ONLINE_STORE_CHANNEL } from "../lib/notion/shop-orders.blocks.js";
import { listInvoicesForAnalytics } from "../lib/notion/invoice.repository.js";
import type { InvoiceAnalyticsRecord } from "../lib/notion/invoice.schema.js";
import { listVariants } from "../lib/notion/products.repository.js";
import { dateInZone, addCalendarDays } from "../lib/appointments/time.js";
import { appointmentTimezone } from "../lib/appointments/settings.js";
import { orderLifecycleState } from "./delivery.js";
import { resolveStoredOrderService } from "../lib/service-catalog.js";
import {
  commissionCapacity,
  intakeSwitch,
  resolveIntake,
  type IntakeReason,
} from "./capacity.js";
import {
  getConsignmentOverview,
  type ConsignmentOverview,
} from "./consignment.service.js";
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

/** One piece out on consignment, named. */
export interface StudioConsignmentItem {
  name: string;
  atShop: number;
  sold: number;
}

/** The consignment shelf as the dashboard reads it: the service's own summary,
 * with its inventory ids resolved to piece names. */
export type StudioConsignment = Omit<ConsignmentOverview, "items"> & {
  items: StudioConsignmentItem[];
};

/** One sales channel's trade over the reporting window. */
export interface StudioChannelSales {
  /** The live `Sales Channel` option, or "" for orders carrying none — the
   * caller renders that as "not recorded". Deliberately NOT a sentinel string:
   * any word invented here could collide with a channel the atelier adds. */
  channel: string;
  orders: number;
  revenue: number;
}

/** What the best-seller list can and cannot see. The list is built from each
 * order's `Inventory Items` relation, which only some orders carry, so a short
 * list is ambiguous between "nothing sells" and "nothing is linked" unless the
 * gap is stated. */
export interface StudioTopItemCoverage {
  /** Orders in the window whose pieces are counted below. */
  counted: number;
  /** Orders whose pieces are NOT counted, because the row links no inventory. */
  unlinked: number;
}

export interface StudioAnalyticsResult {
  generatedAt: string;
  customOrders: StudioPipeline;
  shopOrders: StudioPipeline;
  production: StudioProductionLoad;
  revenue: StudioRevenueMonth[];
  payments: StudioPaymentTotals;
  topItems: StudioTopItem[];
  topItemCoverage: StudioTopItemCoverage;
  channels: StudioChannelSales[];
  consignment: StudioConsignment;
  capacity: StudioCapacity;
}

/** The commission-capacity gate, as the studio's own panel shows it. */
export interface StudioCapacity {
  open: boolean;
  reason: IntakeReason;
  limit: number;
  inProduction?: number;
}

/** Everything the aggregation reads, so it stays pure and testable. */
export interface StudioAnalyticsInput {
  orders: OrderAnalyticsRecord[];
  /** The live custom-order Stage list, in order. */
  stages: string[];
  shopOrders: ShopOrderAnalyticsRecord[];
  /** The live shop fulfilment Status list, in order. */
  shopStatuses: string[];
  /** The live `Sales Channel` options, in the atelier's own order. Channels with
   * no trade are still laid out, as noughts — "no Etsy orders this year" is a
   * figure worth being able to read. */
  shopChannels: string[];
  /** The consignment shelf, read separately (it has no orders to scan). */
  consignment: ConsignmentOverview;
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

/** A bare `YYYY-MM-DD`, with no time on it. */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar date a shop order belongs to, in the studio's timezone.
 *
 * The atelier's own `Order Date` wins, because Notion's page-creation time is
 * the day the ROW was made: right to the second for an order the app wrote, and
 * badly wrong for the Etsy receipts and skate-shop sales typed up weeks later —
 * a channel breakdown built on it would report months of another shop's trade as
 * happening on the evening somebody caught up on paperwork.
 *
 * A DATE-ONLY value is taken exactly as written. It is a day the atelier chose,
 * not an instant, and pushing it through a timezone is how `2026-09-01` becomes
 * August: parsed as UTC midnight and read in America/Chicago it lands on the
 * 31st, moving a sale into the previous month's figures. Only a value carrying a
 * real time is converted.
 */
function orderedOn(
  order: ShopOrderAnalyticsRecord,
  timeZone: string,
): string | null {
  const stated = order.orderDate;
  if (stated) {
    if (CALENDAR_DATE.test(stated)) return stated;
    const instant = parseInstant(stated);
    if (instant) return dateInZone(instant, timeZone);
  }
  const created = parseInstant(order.createdTime);
  return created ? dateInZone(created, timeZone) : null;
}

/**
 * Which channel an order's money belongs to.
 *
 * A blank `Sales Channel` means one of two different things, and the Stripe
 * session id tells them apart: an order carrying one was taken by this app, so
 * it IS the online store however untagged the row is (every order predating the
 * stamp is in that state). An order with neither is one somebody filed and
 * didn't tag, and it stays "" — reported as unattributed rather than quietly
 * credited to the website, which is the one channel we can be sure it isn't.
 */
export function resolveChannel(order: ShopOrderAnalyticsRecord): string {
  if (order.channel) return order.channel;
  return order.sessionId ? SHOP_ORDER_ONLINE_STORE_CHANNEL : "";
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

/**
 * The window the trailing figures cover, as calendar dates in the studio's zone.
 *
 * The revenue series, the channel breakdown and the consignment takings all read
 * it, so the three answer the same question about the same period rather than
 * quietly covering different ones.
 */
export function reportingWindow(
  now: Date,
  timeZone: string,
): { from: string; to: string } {
  const thisMonth = monthOf(now, timeZone);
  const first = shiftMonth(thisMonth, -(REVENUE_MONTHS - 1));
  const [year, index] = thisMonth.split("-").map(Number);
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return { from: `${first}-01`, to: `${thisMonth}-${pad2(lastDay)}` };
}

/** Whether a calendar date falls inside the reporting window. ISO dates sort
 * lexicographically, so string comparison is calendar order. */
function inWindow(date: string, window: { from: string; to: string }): boolean {
  return date >= window.from && date <= window.to;
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
    const placed = orderedOn(order, input.timeZone);
    if (!placed) continue;
    const entry = months.get(placed.slice(0, 7));
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

/**
 * Trade by sales channel over the reporting window.
 *
 * Laid out over the LIVE option list, so a channel with no orders this year
 * still reads as a nought rather than vanishing — the same reason the pipeline
 * panels keep their empty stages. A channel value on an order that is no longer
 * an option (the atelier renamed or deleted it) is appended after the live ones
 * rather than dropped: money that was taken was taken, whatever the list says
 * today. Untagged orders trail as `channel: ""`, and only when there are some.
 */
function buildChannels(
  shopOrders: ShopOrderAnalyticsRecord[],
  liveChannels: string[],
  window: { from: string; to: string },
  timeZone: string,
): StudioChannelSales[] {
  const totals = new Map<string, StudioChannelSales>();
  for (const channel of liveChannels) {
    totals.set(channel, { channel, orders: 0, revenue: 0 });
  }

  const extras: StudioChannelSales[] = [];
  const entryFor = (channel: string): StudioChannelSales => {
    let entry = totals.get(channel);
    if (!entry) {
      entry = { channel, orders: 0, revenue: 0 };
      totals.set(channel, entry);
      extras.push(entry);
    }
    return entry;
  };

  for (const order of shopOrders) {
    if (order.cancelled) continue;
    const placed = orderedOn(order, timeZone);
    if (!placed || !inWindow(placed, window)) continue;
    const entry = entryFor(resolveChannel(order));
    entry.orders += 1;
    entry.revenue += order.total ?? 0;
  }

  // Live options in the atelier's own order, then anything unrecognized, then
  // the untagged bucket — which is a gap in the records rather than a channel,
  // so it reads last.
  const live = liveChannels
    .map((channel) => totals.get(channel))
    .filter((entry): entry is StudioChannelSales => entry !== undefined);
  const unknown = extras.filter((entry) => entry.channel !== "");
  const unattributed = extras.filter((entry) => entry.channel === "");

  return [...live, ...unknown, ...unattributed].map((entry) => ({
    ...entry,
    revenue: round2(entry.revenue),
  }));
}

/**
 * How much of the window's trade the best-seller list can actually see.
 *
 * The list is built from each order's `Inventory Items` relation, and only
 * orders the app wrote (with relation links switched on) carry one — an Etsy
 * receipt typed up by hand names its pieces in free text, if at all. Without
 * this the panel's silence is ambiguous between "nothing sells" and "nothing is
 * linked", and the second is the true answer far more often.
 */
function buildTopItemCoverage(
  shopOrders: ShopOrderAnalyticsRecord[],
  window: { from: string; to: string },
  timeZone: string,
): StudioTopItemCoverage {
  let counted = 0;
  let unlinked = 0;
  for (const order of shopOrders) {
    if (order.cancelled) continue;
    const placed = orderedOn(order, timeZone);
    if (!placed || !inWindow(placed, window)) continue;
    if (order.itemIds.length > 0) counted += 1;
    else unlinked += 1;
  }
  return { counted, unlinked };
}

/** The shop's best sellers, by orders containing each piece. Ids that don't
 * resolve to a live inventory row (archived/unpublished) are dropped rather
 * than shown as a bare page id.
 *
 * Deliberately counts EVERY channel's orders, not just the website's: a piece
 * the atelier sold three of on Etsy is a best seller, and the only thing between
 * that fact and this list is whether the row links its inventory.
 * {@link buildTopItemCoverage} reports how many don't. */
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

/**
 * Resolve the consignment summary's inventory ids to piece names.
 *
 * A piece whose id doesn't resolve to a live inventory row is dropped from the
 * LIST — the same rule as the best sellers, since a bare Notion page id tells
 * the atelier nothing — but its units stay in the totals above, which are the
 * authority on what is out there.
 */
function nameConsignmentItems(
  overview: ConsignmentOverview,
  itemNames: Map<string, string>,
): StudioConsignment {
  const { items, ...rest } = overview;
  return {
    ...rest,
    items: items.flatMap((item) => {
      const name = item.itemId ? itemNames.get(item.itemId) : undefined;
      return name ? [{ name, atShop: item.atShop, sold: item.sold }] : [];
    }),
  };
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
  const window = reportingWindow(input.now, input.timeZone);

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
    topItemCoverage: buildTopItemCoverage(
      input.shopOrders,
      window,
      input.timeZone,
    ),
    channels: buildChannels(
      input.shopOrders,
      input.shopChannels,
      window,
      input.timeZone,
    ),
    // Named by the caller, which is the only place inventory page ids can be
    // resolved to piece names (the consignment reader has the ids, the products
    // read has the names, and neither should have to know about the other).
    consignment: nameConsignmentItems(input.consignment, input.itemNames),
    capacity: buildCapacity(activeOrders),
  };
}

/**
 * The commission-capacity gate, computed from the orders this scan already read.
 *
 * The public `GET /capacity` runs its own narrow, filtered count — this one is
 * free here, because the aggregation has every order in hand and has already
 * classified them. The two can differ by up to a minute (each caches its own
 * read), which is fine: this panel is the atelier looking at their own numbers,
 * not the decision that gates an order.
 *
 * `activeOrders` is `orderLifecycleState === "active"` over each order's OWN
 * pipeline, which is the same test the count's Notion filter approximates — so
 * "in production" means the same thing on both sides.
 */
function buildCapacity(
  activeOrders: readonly OrderAnalyticsRecord[],
): StudioCapacity {
  const inProduction = activeOrders.filter(
    (order) => resolveStoredOrderService(order.service).capacityGated,
  ).length;
  const limit = commissionCapacity();
  const { open, reason } = resolveIntake(inProduction, {
    capacity: limit,
    override: intakeSwitch(),
  });

  // Always present here, unlike the public read: the scan is the dashboard, so
  // a failure surfaces as a 500 rather than an unknown count.
  return { open, reason, limit, inProduction };
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

  const now = new Date();
  // The studio's own timezone. It's configured once, as the zone the atelier's
  // booking hours are kept in, and reused here so "this month" and "overdue"
  // mean what the studio means by them.
  const timeZone = appointmentTimezone();

  const [orders, shop, invoices, variants, consignment] = await Promise.all([
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
    // Reports its own unconfigured / unreachable states rather than throwing, so
    // a shelf nobody has wired up costs the panel its numbers and not the
    // dashboard its figures.
    getConsignmentOverview(reportingWindow(now, timeZone)),
  ]);

  const result = aggregateStudioAnalytics({
    orders: orders.orders,
    stages: orders.stages,
    shopOrders: shop.orders,
    shopStatuses: shop.statuses,
    shopChannels: shop.channels,
    consignment,
    invoices,
    itemNames: new Map(variants.map((variant) => [variant.id, variant.name])),
    now,
    timeZone,
  });

  cached = { result, fetchedAt: Date.now() };
  return result;
}
