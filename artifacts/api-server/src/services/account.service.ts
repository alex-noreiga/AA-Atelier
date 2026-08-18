// Account-portal use-cases, independent of HTTP. Gather everything tied to a
// signed-in customer's email for the dashboard. Identity is the email itself (no
// user table) — the Supabase access token the caller presents is proof they
// control that inbox, so the overview is just the existing order/shop-order
// lookups re-keyed from order number to email. (Sign-in itself runs on Supabase
// Auth in the browser; there's no server-side login/verify flow anymore.)

import {
  findOrdersByEmail,
  findOrdersByNumbers,
} from "../lib/notion/orders.repository.js";
import {
  findShopOrdersByEmail,
  findShopOrdersByNumbers,
  fetchLiveShopOrderStatuses,
} from "../lib/notion/shop-orders.repository.js";
import type { OrderSummary } from "../lib/notion/orders.schema.js";
import type { ShopOrderRecord } from "../lib/notion/shop-orders.repository.js";
import { postgresConfigured } from "../lib/db/client.js";
import { findOrderRefsByEmail } from "../lib/db/order-index.repository.js";
import { listUpcomingAppointmentsByEmail } from "../lib/google/calendar.repository.js";
import {
  eventToDetailsOrNull,
  type AppointmentManageDetails,
} from "../lib/appointments/event-details.js";
import {
  signToken,
  authConfigured,
  APPOINTMENT_MANAGE_TTL_SECONDS,
} from "../lib/auth/tokens.js";
import { ensureReferralCode, type ReferralInfo } from "./rewards.service.js";
import { orderLifecycleState, type OrderLifecycleState } from "./delivery.js";
import { logger } from "../lib/logger.js";

/** An upcoming appointment for the dashboard: its details plus a signed token so
 * the portal can reschedule/cancel it through the existing manage endpoints. */
export interface AccountAppointment extends AppointmentManageDetails {
  manageToken: string;
}

/** A dashboard order, tagged with where it sits in its lifecycle so the portal
 * can denote a finished or cancelled order rather than leaving the customer to
 * read it out of a stage name. Derived server-side (see `delivery.ts`) so both
 * order kinds are classified by the one rule. */
export type AccountCustomOrder = OrderSummary & { state: OrderLifecycleState };
export type AccountShopOrder = ShopOrderRecord & { state: OrderLifecycleState };

export interface AccountOverviewResult {
  email: string;
  customOrders: AccountCustomOrder[];
  shopOrders: AccountShopOrder[];
  appointments: AccountAppointment[];
  /** The customer's referral-program state, absent when the CRM is unconfigured. */
  referral?: ReferralInfo;
}

/**
 * The customer's upcoming appointments for the dashboard, found by the email
 * stamped on each Google Calendar booking. Best-effort: any failure — the
 * calendar integration being unconfigured, a Google outage, an unsigned portal —
 * yields an empty list rather than failing the whole overview (the orders are the
 * dashboard's core; appointments are an add-on). Only still-confirmed events are
 * surfaced; each is tagged with a signed manage token so the portal can drive the
 * existing reschedule/cancel endpoints in place.
 */
async function upcomingAppointments(
  email: string,
): Promise<AccountAppointment[]> {
  // The manage token can't be signed without the portal secret (and the overview
  // is unreachable without it anyway) — skip cleanly rather than throw.
  if (!authConfigured()) return [];

  try {
    const events = await listUpcomingAppointmentsByEmail(email);
    const appointments: AccountAppointment[] = [];
    for (const { staff, event } of events) {
      const details = eventToDetailsOrNull(event, staff);
      // Skip legacy/unrecognizable events (null) and anything not still confirmed.
      if (!details || details.status !== "confirmed") continue;
      const manageToken = signToken(
        email,
        "appointment",
        APPOINTMENT_MANAGE_TTL_SECONDS,
        { eventId: event.id, staff },
      );
      appointments.push({ ...details, manageToken });
    }
    return appointments;
  } catch (error) {
    logger.warn(
      { err: error },
      "Account overview: could not list appointments; returning none",
    );
    return [];
  }
}

/**
 * The customer's custom orders for the dashboard. Uses the Notion by-email lookup
 * as the never-regress baseline, then — when Postgres is configured — augments it
 * with any orders the index discovers that the exact-email match missed
 * (case-insensitive via `citext`, and legacy orders joined by client id). The PG
 * step is best-effort: a DB failure degrades to the Notion-only result, and it
 * fetches live Stage/measurements from Notion (never a stale cached copy).
 */
async function listCustomOrders(email: string): Promise<AccountCustomOrder[]> {
  const orders = await findOrdersByEmail(email).then(async (base) => {
    if (!postgresConfigured()) return base;
    try {
      const refs = await findOrderRefsByEmail(email, "custom");
      const have = new Set(base.map((o) => o.orderNumber));
      const extra = refs.map((r) => r.orderNumber).filter((n) => !have.has(n));
      if (extra.length === 0) return base;
      return [...base, ...(await findOrdersByNumbers(extra))];
    } catch (err) {
      logger.warn(
        { err },
        "Account overview: Postgres custom-order discovery failed; using Notion-only results",
      );
      return base;
    }
  });

  // Each summary already carries the live stage list it was mapped against, so
  // classifying is pure — no extra Notion read.
  return orders.map((order) => ({
    ...order,
    state: orderLifecycleState(
      order.cancelled === true,
      order.currentStage,
      order.stages,
    ),
  }));
}

/** Shop-order counterpart of {@link listCustomOrders} — same baseline-plus-index
 * union, same best-effort degrade, live fulfilment status from Notion. */
async function listShopOrders(email: string): Promise<AccountShopOrder[]> {
  const orders = await findShopOrdersByEmail(email).then(async (base) => {
    if (!postgresConfigured()) return base;
    try {
      const refs = await findOrderRefsByEmail(email, "shop");
      const have = new Set(base.map((o) => o.orderNumber));
      const extra = refs.map((r) => r.orderNumber).filter((n) => !have.has(n));
      if (extra.length === 0) return base;
      return [...base, ...(await findShopOrdersByNumbers(extra))];
    } catch (err) {
      logger.warn(
        { err },
        "Account overview: Postgres shop-order discovery failed; using Notion-only results",
      );
      return base;
    }
  });

  if (orders.length === 0) return [];

  // Unlike a custom order, a shop-order record doesn't carry its status list, so
  // read the live one (60s cached) to place each order in it. Best-effort: an
  // empty list classifies everything uncancelled as active, which is the safe
  // way to be wrong — an order is never wrongly shown as finished.
  const statuses = await fetchLiveShopOrderStatuses().catch((err) => {
    logger.warn(
      { err },
      "Account overview: could not read shop-order statuses; orders show as in progress",
    );
    return [] as string[];
  });

  return orders.map((order) => ({
    ...order,
    state: orderLifecycleState(
      order.cancelled === true,
      order.status,
      statuses,
    ),
  }));
}

/**
 * Everything the account dashboard shows for a signed-in customer: their custom
 * orders, shop orders, and upcoming appointments, all looked up by the session
 * email. The lookups are independent, so run them together — and appointments
 * degrade to empty on their own (see `upcomingAppointments`) so a calendar hiccup
 * never fails the orders view.
 */
export async function getAccountOverview(
  email: string,
): Promise<AccountOverviewResult> {
  const [customOrders, shopOrders, appointments, referral] = await Promise.all([
    listCustomOrders(email),
    listShopOrders(email),
    upcomingAppointments(email),
    // Best-effort: a customer's referral code, generated on first view. Degrades
    // to null (no referral block) when the CRM is unconfigured or unreachable, so
    // it never fails the dashboard's core orders view.
    ensureReferralCode(email).catch((err) => {
      logger.warn({ err }, "Account overview: could not resolve referral info");
      return null;
    }),
  ]);

  return {
    email,
    customOrders,
    shopOrders,
    appointments,
    ...(referral ? { referral } : {}),
  };
}
