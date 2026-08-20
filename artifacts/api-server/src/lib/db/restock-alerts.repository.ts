// "Have we already told this customer their piece is back?", backed by the
// `restock_alerts` table.
//
// This is the back-in-stock alert's whole idempotency story, and it lives here
// rather than as a checkbox on the Notion request row for two reasons: the
// feature then needs no Notion setup at all, and an app-owned marker in a table
// the atelier doesn't edit can't be un-ticked by hand into a second email.
//
// The claim is `insert … on conflict do nothing`, the same primitive
// `processed_payments` uses — but without its confirm/release cycle. A payment
// claim must be released on failure or a paid order is never recorded; here the
// worst case of a claim that is never followed by a send is one alert lost,
// which is the safe direction to fail (see `notifyRestock`).

import { getDb, type DbClient } from "./client.js";

/** The request being answered — the Notion page id is the claim key; the rest is
 * recorded so the table reads on its own when someone asks "who did we tell?". */
export interface RestockAlertClaim {
  requestPageId: string;
  item: string;
  /** The size band asked about, or "" for the whole piece. */
  size: string;
  email: string;
}

/**
 * Try to claim one back-in-stock request as alerted. `true` means this caller
 * owns the send; `false` means someone already did it (a previous run, or a
 * concurrent one — the nightly sweep and a dashboard press can overlap).
 *
 * The caller must treat a throw as "not claimed" and skip the send: without the
 * marker there is nothing to stop the next run repeating it, so failing closed
 * costs at most a delayed alert while failing open costs a duplicate.
 */
export async function claimRestockAlert(
  claim: RestockAlertClaim,
  db: DbClient = getDb(),
): Promise<boolean> {
  const inserted = await db.query<{ request_page_id: string }>(
    `insert into restock_alerts (request_page_id, item, size, email)
     values ($1, $2, $3, $4)
     on conflict (request_page_id) do nothing
     returning request_page_id`,
    [claim.requestPageId, claim.item, claim.size, claim.email],
  );
  return inserted.length > 0;
}
