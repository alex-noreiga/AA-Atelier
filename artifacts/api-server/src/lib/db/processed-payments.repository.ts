// Atomic Stripe-payment idempotency, backed by the `processed_payments` table.
// Replaces the Notion read-before-write dedup (`findOrderBySessionId`) with a
// real unique-constraint claim: the webhook CLAIMS a session id, does the Notion
// write, then CONFIRMS; any failure RELEASES the claim so a Stripe redelivery
// reprocesses cleanly. See `recordPaidOrder` in services/checkout.service.ts.

import { getDb, type DbClient } from "./client.js";

export type ClaimResult = "claimed" | "done" | "in_progress";

/** How long a `processing` claim may sit before a retry may reclaim it. A hard
 * crash between claim and confirm leaves a stale row; without this window a
 * payment could be swallowed forever (every retry would see `in_progress`). */
const STALE_CLAIM_MINUTES = 10;

/**
 * Try to claim a Stripe session for processing.
 *  - `claimed`     — we own it (freshly inserted, or an expired predecessor's
 *                    claim reclaimed); proceed with the work.
 *  - `done`        — already fully recorded; the caller no-ops.
 *  - `in_progress` — a concurrent/uncommitted peer holds it; the caller should
 *                    fail so Stripe redelivers later.
 */
export async function claimPayment(
  sessionId: string,
  kind: string,
  db: DbClient = getDb(),
): Promise<ClaimResult> {
  const inserted = await db.query<{ stripe_session_id: string }>(
    `insert into processed_payments (stripe_session_id, kind)
     values ($1, $2)
     on conflict (stripe_session_id) do nothing
     returning stripe_session_id`,
    [sessionId, kind],
  );
  if (inserted.length > 0) return "claimed";

  const rows = await db.query<{ status: string; stale: boolean }>(
    `select status,
            (now() - created_at) > ($2 || ' minutes')::interval as stale
       from processed_payments
      where stripe_session_id = $1`,
    [sessionId, String(STALE_CLAIM_MINUTES)],
  );
  const row = rows[0];
  // Row vanished (a concurrent release) — force a retry that re-inserts cleanly.
  if (!row) return "in_progress";
  if (row.status === "done") return "done";
  if (row.stale) {
    // A crashed predecessor left this claim; take it over (reset the clock).
    await db.query(
      `update processed_payments set created_at = now() where stripe_session_id = $1`,
      [sessionId],
    );
    return "claimed";
  }
  return "in_progress";
}

/** Mark a claimed session fully recorded, so redeliveries no-op. */
export async function confirmPayment(
  sessionId: string,
  db: DbClient = getDb(),
): Promise<void> {
  await db.query(
    `update processed_payments
        set status = 'done', confirmed_at = now()
      where stripe_session_id = $1`,
    [sessionId],
  );
}

/** Drop a claim so a retry reprocesses (used on failure / a non-paid session). */
export async function releasePayment(
  sessionId: string,
  db: DbClient = getDb(),
): Promise<void> {
  await db.query(
    `delete from processed_payments where stripe_session_id = $1`,
    [sessionId],
  );
}
