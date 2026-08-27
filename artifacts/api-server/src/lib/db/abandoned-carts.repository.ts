// The abandoned-cart reminder's pending queue, backed by the `abandoned_carts`
// table. A row is a PENDING reminder, keyed on the (citext, case-insensitive)
// email — see 0005_abandoned_carts.sql for why a row never outlives its
// resolution: it is deleted when the reminder sends, when a paid checkout with
// the same email lands, or when it expires unsent.
//
// The claim is the DELETE itself (`delete … returning`): exactly one caller
// wins the row, so the nightly sweep and any overlapping run can't both email
// the same cart. There is no confirm/release cycle — a claim that is never
// followed by a send costs one lost reminder, which is the safe direction (the
// same call restock_alerts makes, from the other side of the row's lifetime).

import { getDb, type DbClient } from "./client.js";

/** One cart line, snapshotted for the reminder email's copy. Display-only —
 * never trusted for money (checkout reprices from live inventory). */
export interface SavedCartItem {
  variantId: string;
  name: string;
  size?: string;
  quantity: number;
  /** Listed unit price in dollars when the cart was saved, for the email copy. */
  price?: number;
}

/** A pending reminder, as the sweep reads it back. */
export interface AbandonedCart {
  email: string;
  items: SavedCartItem[];
  /** When the cart was last saved — the abandonment clock. */
  updatedAt: Date;
}

/**
 * Save (or replace) the pending cart for an email. A second save overwrites the
 * snapshot and restarts the clock — a customer who kept shopping has a newer
 * cart, not two.
 */
export async function saveAbandonedCart(
  email: string,
  items: SavedCartItem[],
  db: DbClient = getDb(),
): Promise<void> {
  await db.query(
    `insert into abandoned_carts (email, items)
     values ($1, $2::jsonb)
     on conflict (email) do update
       set items = excluded.items, updated_at = now()`,
    [email, JSON.stringify(items)],
  );
}

/** The driver returns jsonb parsed; a fake (or a text cast) may hand back a
 * string. Accept both, and fold anything else to an empty list rather than
 * throwing inside the sweep. */
function parseItems(value: unknown): SavedCartItem[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? (parsed as SavedCartItem[]) : [];
}

/**
 * The carts due a reminder: last saved on or before `abandonedBefore` (the
 * delay window has fully passed). Oldest first, bounded — a sweep that somehow
 * finds thousands of rows should drain over a few nights rather than fan out
 * unboundedly on a serverless function.
 */
export async function findDueAbandonedCarts(
  abandonedBefore: Date,
  db: DbClient = getDb(),
): Promise<AbandonedCart[]> {
  const rows = await db.query<{
    email: string;
    items: unknown;
    updated_at: string | Date;
  }>(
    `select email, items, updated_at
     from abandoned_carts
     where updated_at <= $1
     order by updated_at asc
     limit 200`,
    [abandonedBefore.toISOString()],
  );
  return rows.map((row) => ({
    email: row.email,
    items: parseItems(row.items),
    updatedAt: new Date(row.updated_at),
  }));
}

/**
 * Atomically claim-and-remove one pending cart. `true` means this caller owns
 * the send; `false` means the row is no longer claimable: another run got there
 * first, the checkout completed and cleared it, or the customer re-saved the
 * cart since the sweep read it. That last case is why the predicate re-checks
 * `updated_at <= abandonedBefore` (the same cutoff the sweep queried with)
 * instead of deleting by email alone — a freshly re-saved cart no longer
 * satisfies it and keeps its full delay. A timestamp-equality match would be
 * the natural guard but is a precision trap: the driver's Date is millisecond-
 * truncated while Postgres stores microseconds, so equality would never hold.
 *
 * Callers must treat a throw as "not claimed" and skip the send: an unclaimed
 * send would repeat on the next run, and a duplicate marketing-adjacent email
 * is worse than a late one.
 */
export async function claimAbandonedCart(
  email: string,
  abandonedBefore: Date,
  db: DbClient = getDb(),
): Promise<boolean> {
  const deleted = await db.query<{ email: string }>(
    `delete from abandoned_carts
     where email = $1 and updated_at <= $2
     returning email`,
    [email, abandonedBefore.toISOString()],
  );
  return deleted.length > 0;
}

/**
 * Cancel the pending reminder for an email — the checkout completed, so there
 * is nothing to recover. Idempotent (no row ⇒ nothing to do).
 */
export async function clearAbandonedCart(
  email: string,
  db: DbClient = getDb(),
): Promise<void> {
  await db.query(`delete from abandoned_carts where email = $1`, [email]);
}

/**
 * Drop carts that aged out unsent (older than the sweep's maximum age). A cart
 * this old was missed — the honest move is to say nothing, not to "remind"
 * someone about a cart from a month ago. Returns how many were dropped.
 */
export async function deleteExpiredAbandonedCarts(
  expiredBefore: Date,
  db: DbClient = getDb(),
): Promise<number> {
  const deleted = await db.query<{ email: string }>(
    `delete from abandoned_carts where updated_at <= $1 returning email`,
    [expiredBefore.toISOString()],
  );
  return deleted.length;
}
