// Back-in-stock alert use-case, independent of HTTP.
//
// The shop already captures "tell me when this returns" requests (notify.service)
// and acknowledges them — but nothing closed the loop. This does, and it does it
// WITHOUT asking anything of Notion: no automation, no webhook, no marker
// property. Two triggers, both already in the app:
//
//   1. the nightly reconciliation cron (`sendDueRestockAlerts` in
//      schedule.service), alongside the fitting and payment reminder passes;
//   2. the studio dashboard's "Send back-in-stock alerts" tool, for running it
//      the moment a piece is restocked rather than waiting for the night.
//
// Both call this. It is a SWEEP, not a per-row handler: it reads live inventory,
// takes every piece that is currently available, and answers the requests waiting
// on them. Scoping it to one `item` only narrows which pieces are considered —
// the availability test is the same either way, so a piece that isn't actually
// back is never alerted on, however the run was started.
//
// Three rules carry the design:
//
//   1. **Availability is read, never asserted.** The caller says "sweep" or
//      "sweep this piece"; it never says "this is in stock". Inventory is read
//      fresh (bypassing the 60s cache — see `listVariants`) and this decides.
//   2. **Send once, claimed in Postgres.** `restock_alerts` holds one row per
//      answered request. The claim is atomic, so the nightly sweep and a
//      dashboard press can overlap without double-emailing, and a failed claim
//      means "don't send" — losing an alert beats sending two.
//   3. **A request the restock doesn't answer is left alone.** Someone waiting on
//      a size that is still sold out keeps their place in the queue for the
//      restock that does answer them.
//
// Emails are best-effort (a Resend failure is logged-and-swallowed by
// `sendEmailBestEffort`). There is deliberately no internal atelier notification:
// the run reports what it did to whoever started it — the cron's JSON, or the
// dashboard's result panel.

import { listVariants } from "../lib/notion/products.repository.js";
import {
  findPendingBackInStockRequests,
  type PendingRestockRequest,
} from "../lib/notion/notify.repository.js";
import { claimRestockAlert } from "../lib/db/restock-alerts.repository.js";
import { postgresConfigured } from "../lib/db/client.js";
import type { VariantRecord } from "../lib/notion/products.schema.js";
import { restockSatisfiesRequest, shopProductUrl } from "./restock.js";
import { backInStockAlertEmail } from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress } from "../lib/resend/config.js";
import { logger } from "../lib/logger.js";

/** How to scope a run: everything currently back in stock, or one named piece. */
export interface RestockRunOptions {
  /** An inventory row's exact `Item Name`. Omitted ⇒ sweep every piece. */
  item?: string;
}

/** How many customers were emailed about one piece. */
export interface RestockItemResult {
  item: string;
  notified: number;
}

/** The outcome of a sweep, for the caller's response. */
export interface RestockNotificationResult {
  status: "sent" | "skipped" | "not_found" | "unconfigured";
  /** Total customers emailed. */
  notified: number;
  /** Requests this restock didn't answer — waiting on a size still sold out. */
  unmatched: number;
  /** Requests already answered by an earlier run (a repeat press, or the cron). */
  alreadyAlerted: number;
  /** Per-piece breakdown of the emails sent, in inventory order. */
  items: RestockItemResult[];
  /** The piece the run was scoped to, when it was scoped to one. */
  item?: string;
  /** Why nothing was sent. */
  reason?: string;
}

function empty(
  status: RestockNotificationResult["status"],
  extra: Partial<RestockNotificationResult> = {},
): RestockNotificationResult {
  return {
    status,
    notified: 0,
    unmatched: 0,
    alreadyAlerted: 0,
    items: [],
    ...extra,
  };
}

/**
 * Claim one request, failing closed. A Postgres error means we can't record that
 * the alert went out, and an unrecorded alert is repeated on the next run — so an
 * outage suppresses the send rather than risking a duplicate.
 */
async function claim(request: PendingRestockRequest): Promise<boolean> {
  try {
    return await claimRestockAlert({
      requestPageId: request.pageId,
      item: request.item,
      size: request.size,
      email: request.email,
    });
  } catch (err) {
    logger.warn(
      { err, request: request.pageId },
      "Couldn't claim a back-in-stock alert; skipping the send so the next run can retry",
    );
    return false;
  }
}

/**
 * Alert everyone waiting on a piece that is back in stock, for every available
 * piece (or just `options.item`). Reads live inventory and the waiting requests,
 * claims each answerable request in Postgres, and emails the ones it wins.
 *
 * Only the Notion reads throw; the emails and the claims never do, so one bad
 * request can't strand the rest of the queue.
 */
export async function notifyRestock(
  options: RestockRunOptions = {},
): Promise<RestockNotificationResult> {
  const scopedTo = options.item?.trim();
  const scope = scopedTo ? { item: scopedTo } : {};

  // The alert has exactly one durable requirement, and it isn't optional: without
  // somewhere to record who has been told, a nightly sweep would re-email the
  // same people every night. Better to do nothing and say so.
  if (!postgresConfigured()) {
    logger.warn(
      "Back-in-stock alerts skipped: POSTGRES_URL is not configured, so there is nowhere to record who has already been alerted.",
    );
    return empty("unconfigured", {
      ...scope,
      reason:
        "POSTGRES_URL isn't configured, so there's nowhere to record who has already been told.",
    });
  }

  const variants = await listVariants(undefined, { fresh: true });

  let candidates: VariantRecord[];
  if (scopedTo) {
    const named = variants.filter((variant) => variant.name === scopedTo);
    if (named.length === 0) {
      return empty("not_found", scope);
    }
    candidates = named.filter((variant) => variant.available);
    if (candidates.length === 0) {
      return empty("skipped", { ...scope, reason: "not in stock" });
    }
  } else {
    candidates = variants.filter((variant) => variant.available);
    if (candidates.length === 0) {
      return empty("skipped", {
        ...scope,
        reason: "nothing is in stock right now",
      });
    }
  }

  const requests = await findPendingBackInStockRequests();
  const byItem = new Map<string, PendingRestockRequest[]>();
  for (const request of requests) {
    const waiting = byItem.get(request.item);
    if (waiting) waiting.push(request);
    else byItem.set(request.item, [request]);
  }

  const from = fromAddress("orders");
  const items: RestockItemResult[] = [];
  let notified = 0;
  let unmatched = 0;
  let alreadyAlerted = 0;

  for (const variant of candidates) {
    const waiting = byItem.get(variant.name);
    if (!waiting) continue;

    const productUrl = shopProductUrl(variant);
    let sentForItem = 0;

    for (const request of waiting) {
      // A per-size request is only answered when THAT band is back — the row
      // stays unclaimed (and in the queue) until it is.
      if (!restockSatisfiesRequest(variant, request.size)) {
        unmatched += 1;
        continue;
      }
      if (!(await claim(request))) {
        alreadyAlerted += 1;
        continue;
      }

      await sendEmailBestEffort({
        ...backInStockAlertEmail({
          email: request.email,
          item: variant.name,
          ...(request.size ? { size: request.size } : {}),
          ...(productUrl ? { productUrl } : {}),
        }),
        from,
      });
      sentForItem += 1;
      notified += 1;
    }

    if (sentForItem > 0)
      items.push({ item: variant.name, notified: sentForItem });
  }

  if (notified === 0) {
    return {
      ...empty("skipped", scope),
      unmatched,
      alreadyAlerted,
      reason:
        alreadyAlerted > 0
          ? "everyone waiting has already been told"
          : unmatched > 0
            ? "no waiting request matches the sizes that are back"
            : "there was nobody waiting on what's in stock",
    };
  }

  logger.info(
    { notified, unmatched, alreadyAlerted, items, ...scope },
    "Sent back-in-stock alerts",
  );
  return {
    status: "sent",
    notified,
    unmatched,
    alreadyAlerted,
    items,
    ...scope,
  };
}
