// Account-portal use-cases, independent of HTTP. Two things: send a passwordless
// sign-in link, and gather everything tied to a signed-in customer's email for
// the dashboard. Identity is the email itself (no user table) — a valid session
// cookie is proof the customer controls that inbox, so the overview is just the
// existing order/shop-order lookups re-keyed from order number to email.

import { findOrdersByEmail } from "../lib/notion/orders.repository.js";
import { findShopOrdersByEmail } from "../lib/notion/shop-orders.repository.js";
import type { OrderSummary } from "../lib/notion/orders.schema.js";
import type { ShopOrderRecord } from "../lib/notion/shop-orders.repository.js";
import { listUpcomingAppointmentsByEmail } from "../lib/google/calendar.repository.js";
import {
  eventToDetailsOrNull,
  type AppointmentManageDetails,
} from "../lib/appointments/event-details.js";
import {
  signToken,
  authConfigured,
  MAGIC_LINK_TTL_SECONDS,
  APPOINTMENT_MANAGE_TTL_SECONDS,
} from "../lib/auth/tokens.js";
import { magicLinkEmail } from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress } from "../lib/resend/config.js";
import { logger } from "../lib/logger.js";

/** An upcoming appointment for the dashboard: its details plus a signed token so
 * the portal can reschedule/cancel it through the existing manage endpoints. */
export interface AccountAppointment extends AppointmentManageDetails {
  manageToken: string;
}

export interface AccountOverviewResult {
  email: string;
  customOrders: OrderSummary[];
  shopOrders: ShopOrderRecord[];
  appointments: AccountAppointment[];
}

/** The origin the emailed magic link points back at (Stripe already needs this). */
function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
}

/**
 * Email the customer a one-time sign-in link. Best-effort throughout: it's a
 * no-op (logged) when the portal secret or the public base URL isn't configured,
 * and the email send itself never throws (a mail outage doesn't fail the request).
 * The caller always responds with a generic acknowledgement — there is no account
 * to enumerate, since identity is the email.
 */
export async function requestMagicLink(email: string): Promise<void> {
  const trimmed = email.trim();
  if (!trimmed) return;

  if (!authConfigured()) {
    logger.error(
      "Account portal sign-in requested but SESSION_SECRET is not configured; " +
        "no link sent. Set SESSION_SECRET in the environment.",
    );
    return;
  }

  const base = publicBaseUrl();
  if (!base) {
    logger.error(
      "Account portal sign-in requested but PUBLIC_BASE_URL is not configured; " +
        "cannot build an absolute magic link. Set PUBLIC_BASE_URL.",
    );
    return;
  }

  const token = signToken(trimmed, "magic", MAGIC_LINK_TTL_SECONDS);
  const url = `${base}/api/account/verify?token=${encodeURIComponent(token)}`;

  await sendEmailBestEffort({
    ...magicLinkEmail(trimmed, url),
    from: fromAddress("orders"),
  });
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
 * Everything the account dashboard shows for a signed-in customer: their custom
 * orders, shop orders, and upcoming appointments, all looked up by the session
 * email. The lookups are independent, so run them together — and appointments
 * degrade to empty on their own (see `upcomingAppointments`) so a calendar hiccup
 * never fails the orders view.
 */
export async function getAccountOverview(
  email: string,
): Promise<AccountOverviewResult> {
  const [customOrders, shopOrders, appointments] = await Promise.all([
    findOrdersByEmail(email),
    findShopOrdersByEmail(email),
    upcomingAppointments(email),
  ]);

  return { email, customOrders, shopOrders, appointments };
}
