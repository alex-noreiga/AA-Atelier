// Abandoned-cart recovery, independent of HTTP: the capture half (a visitor
// asks to be reminded about the cart they're leaving) and the sweep half (the
// one follow-up email, riding the nightly reconciliation).
//
// The shop's cart is client-side (localStorage) — the server has no cart to
// watch go stale — so the capture is explicit: the cart drawer offers "email me
// a reminder", and what is stored is a display snapshot of the lines plus the
// email, as ONE pending reminder per email in Postgres (`abandoned_carts`).
// The row's whole lifecycle is its resolution (see the repository header):
//
//   - the sweep claims-and-deletes it when the reminder sends (send once);
//   - a paid checkout with the same email deletes it (the webhook — someone
//     who bought their cart must never be told they abandoned it);
//   - a cart that ages out unsent is dropped silently — "you left this behind
//     a month ago" is a worse email than none.
//
// Like the back-in-stock sweep, Postgres is the one hard requirement and it
// fails quietly-but-visibly: unset ⇒ the capture accepts and warns (a customer
// can't fix the studio's configuration, and blocking the drawer over it would
// be noise), and the sweep no-ops with a warn. The email itself is best-effort
// from the orders sender, like every other customer mail.

import {
  claimAbandonedCart,
  clearAbandonedCart,
  deleteExpiredAbandonedCarts,
  findDueAbandonedCarts,
  saveAbandonedCart,
  type SavedCartItem,
} from "../lib/db/abandoned-carts.repository.js";
import { postgresConfigured } from "../lib/db/client.js";
import { normalizeEmail } from "../lib/email.js";
import { abandonedCartEmail } from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress } from "../lib/resend/config.js";
import { logger } from "../lib/logger.js";

// How many hours a saved cart must sit untouched before the reminder goes out.
// The nightly cron fires in the small hours, so 24 in practice means "the night
// after next": a cart saved on Tuesday afternoon is reminded early Thursday —
// long enough that the customer isn't nagged mid-decision, soon enough that the
// piece is plausibly still in stock.
const DEFAULT_DELAY_HOURS = 24;

// A cart older than this is dropped unsent. Past two weeks the pieces may be
// gone, the intent certainly is, and the email would read as surveillance
// rather than service. Also the data-minimization bound: a saved email + cart
// snapshot never outlives this window.
export const CART_REMINDER_MAX_AGE_DAYS = 14;

/** The reminder delay in hours. Falls back to the default for an unset,
 * non-numeric, or non-positive override. Read at call time (mirrors the other
 * env-tuned business rules); not a Studio-Settings key. */
export function cartReminderDelayHours(): number {
  const raw = process.env.CART_REMINDER_DELAY_HOURS?.trim();
  if (!raw) return DEFAULT_DELAY_HOURS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DELAY_HOURS;
}

/** What the capture endpoint hands over (already contract-validated; the
 * anti-spam fields were consumed by the middleware and never reach this). */
export interface CartReminderInput {
  email: string;
  items: SavedCartItem[];
}

/**
 * Save (or replace) the pending reminder for this email. A repeat save is the
 * customer updating their cart, so it replaces the snapshot and restarts the
 * clock. With Postgres unconfigured the request still succeeds — the customer
 * can't fix the studio's configuration — but the warn says nothing will send.
 */
export async function saveCartReminder(
  input: CartReminderInput,
): Promise<{ success: true }> {
  if (!postgresConfigured()) {
    logger.warn(
      "Cart reminder accepted but not stored: POSTGRES_URL is not configured, so no reminder will ever send.",
    );
    return { success: true };
  }

  await saveAbandonedCart(normalizeEmail(input.email), input.items);
  return { success: true };
}

/**
 * Cancel the pending reminder for an email whose checkout completed. Called
 * from the Stripe webhook, so it must never throw — a reminder that outlives a
 * purchase is an embarrassment, not a reason to 500 a paid order.
 */
export async function cancelCartReminderBestEffort(
  email: string,
): Promise<void> {
  if (!postgresConfigured()) return;
  try {
    await clearAbandonedCart(normalizeEmail(email));
  } catch (err) {
    logger.warn(
      { err },
      "Failed to clear a pending cart reminder for a paid checkout; the customer may still receive one reminder",
    );
  }
}

/** The shop landing page, when PUBLIC_BASE_URL is configured (omitted
 * otherwise, so the email still sends without a broken link). The cart itself
 * lives in the customer's browser, so the shop — not a cart URL — is the link. */
function shopUrl(): string | undefined {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}/shop`;
}

/** What one sweep did, for the cron's JSON. */
export interface CartReminderSweepResult {
  remindersSent: number;
  /** Carts dropped unsent for aging past the maximum window. */
  expired: number;
}

/**
 * Send the one reminder for every cart that has sat past the delay window.
 * Claim-then-send, per cart: the claim is an atomic delete, so an overlapping
 * run can't double-email, and a claim that loses means someone else resolved
 * the row (another run, a completed checkout, or a re-save). A send failure
 * after a won claim costs one lost reminder — the safe direction, same as the
 * back-in-stock sweep.
 */
export async function sweepAbandonedCarts(
  now: Date = new Date(),
): Promise<CartReminderSweepResult> {
  if (!postgresConfigured()) {
    logger.warn(
      "Abandoned-cart reminders skipped: POSTGRES_URL is not configured, so there are no saved carts to sweep.",
    );
    return { remindersSent: 0, expired: 0 };
  }

  // Expire first, so an aged-out cart can't be swept up as "due" below.
  const expiredBefore = new Date(
    now.getTime() - CART_REMINDER_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
  );
  const expired = await deleteExpiredAbandonedCarts(expiredBefore);
  if (expired > 0) {
    logger.info(
      { expired },
      "Dropped abandoned carts that aged out before a reminder was sent",
    );
  }

  const abandonedBefore = new Date(
    now.getTime() - cartReminderDelayHours() * 60 * 60 * 1000,
  );
  const due = await findDueAbandonedCarts(abandonedBefore);

  const from = fromAddress("orders");
  const link = shopUrl();
  let remindersSent = 0;

  for (const cart of due) {
    // Claim failing closed: a throw means we can't record the send, and an
    // unrecorded send repeats tomorrow — so skip and let the next run retry.
    let claimed = false;
    try {
      claimed = await claimAbandonedCart(cart.email, abandonedBefore);
    } catch (err) {
      logger.warn(
        { err, email: cart.email },
        "Couldn't claim an abandoned cart; skipping the send so the next run can retry",
      );
    }
    if (!claimed) continue;

    await sendEmailBestEffort({
      ...abandonedCartEmail({
        email: cart.email,
        items: cart.items,
        ...(link ? { shopUrl: link } : {}),
      }),
      from,
    });
    remindersSent += 1;
  }

  if (remindersSent > 0) {
    logger.info({ remindersSent, expired }, "Sent abandoned-cart reminders");
  }
  return { remindersSent, expired };
}
