// Account-portal use-cases, independent of HTTP. Two things: send a passwordless
// sign-in link, and gather everything tied to a signed-in customer's email for
// the dashboard. Identity is the email itself (no user table) — a valid session
// cookie is proof the customer controls that inbox, so the overview is just the
// existing order/shop-order lookups re-keyed from order number to email.

import { findOrdersByEmail } from "../lib/notion/orders.repository.js";
import { findShopOrdersByEmail } from "../lib/notion/shop-orders.repository.js";
import type { OrderSummary } from "../lib/notion/orders.schema.js";
import type { ShopOrderRecord } from "../lib/notion/shop-orders.repository.js";
import {
  signToken,
  authConfigured,
  MAGIC_LINK_TTL_SECONDS,
} from "../lib/auth/tokens.js";
import { magicLinkEmail } from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress } from "../lib/resend/config.js";
import { logger } from "../lib/logger.js";

export interface AccountOverviewResult {
  email: string;
  customOrders: OrderSummary[];
  shopOrders: ShopOrderRecord[];
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
 * Everything the account dashboard shows for a signed-in customer: their custom
 * orders and their shop orders, both looked up by the session email. The two
 * queries are independent, so run them together.
 */
export async function getAccountOverview(
  email: string,
): Promise<AccountOverviewResult> {
  const [customOrders, shopOrders] = await Promise.all([
    findOrdersByEmail(email),
    findShopOrdersByEmail(email),
  ]);

  return { email, customOrders, shopOrders };
}
