// The commission-capacity use-case: count what's in production, ask the policy in
// `capacity.ts`, and serve the answer to the intake form and the `POST /orders`
// gate.
//
// One decision, two callers, which is the point. The form asks `GET /capacity`
// so it can offer the waitlist instead of a form that would be refused, and
// `submitOrder` asks the same function before it writes — so a customer can't
// slip a commission past a closed door with a stale tab or a direct POST, and
// the two can never disagree about whether the books are open. It is the same
// serve-the-one-definition shape as `GET /services` and its gate.

import { listOpenOrderServices } from "../lib/notion/orders.repository.js";
import { resolveStoredOrderService } from "../lib/service-catalog.js";
import {
  closedMessage,
  commissionCapacity,
  intakeSwitch,
  resolveIntake,
  type IntakeStatus,
} from "./capacity.js";
import { logger } from "../lib/logger.js";

const CACHE_TTL_MS = 60_000;
let cached: { count: number; fetchedAt: number } | null = null;

/** Test seam: drop the cached order count between cases. */
export function __resetCapacityCache(): void {
  cached = null;
}

/**
 * How many capacity-gated orders are in production right now, or `undefined`
 * when that couldn't be read.
 *
 * The `undefined` is the load-bearing part: it is NOT zero. A failed Notion read
 * that returned 0 would look like an empty workroom and hold the books open —
 * which is the right outcome, but for the wrong reason and with the wrong story
 * in the studio panel. Reporting "unknown" gets the same open books and says so.
 *
 * Cached 60s like every other live Notion read, so a page of intake-form loads
 * costs one query. The cache holds only a successful count, so a blip isn't
 * remembered for a minute.
 */
async function countOpenCommissions(): Promise<number | undefined> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.count;
  }

  try {
    const services = await listOpenOrderServices();
    // The catalog decides what a stored `Service` value means, including the
    // empty one an order placed before that property existed carries — which
    // resolves to the bespoke commission, so the studio's own history counts
    // against capacity exactly as a new commission does.
    const count = services.filter(
      (value) => resolveStoredOrderService(value).capacityGated,
    ).length;
    cached = { count, fetchedAt: Date.now() };
    return count;
  } catch (err) {
    logger.warn(
      { err },
      "Failed to count open commissions; the books stay open",
    );
    return undefined;
  }
}

/** The intake decision, for the server-side gate. Never throws. */
export async function getIntakeStatus(): Promise<IntakeStatus> {
  const override = intakeSwitch();
  const capacity = commissionCapacity();

  // Skip the Notion read entirely when the answer can't depend on it — the
  // atelier has forced the books one way, or no cap is set (the default, so
  // this is the path for every studio that hasn't turned the feature on).
  if (override !== "auto" || capacity <= 0) {
    return resolveIntake(undefined, { capacity, override });
  }

  return resolveIntake(await countOpenCommissions(), { capacity, override });
}

/** What `GET /capacity` serves. */
export interface CapacityView {
  open: boolean;
  waitlistOpen: boolean;
  message: string;
}

/**
 * The intake decision as the order form reads it.
 *
 * Deliberately carries NO counts. How many commissions the studio is holding is
 * the studio's own business, and this endpoint is anonymous — "3 of 8 slots
 * left" is a figure a competitor can poll. The studio's own view of the numbers
 * is on the dashboard, behind the staff gate.
 */
export async function getCapacityStatus(): Promise<CapacityView> {
  const status = await getIntakeStatus();

  return {
    open: status.open,
    // Stated rather than derived from `open` at the contract's edge, but they
    // are the same today: a closed door with no waitlist behind it would be a
    // deliberate decision, and the atelier hasn't asked for one.
    waitlistOpen: !status.open,
    // Empty when open — there is nothing to explain, and shipping the closed
    // wording to every visitor invites a page to render it by accident.
    message: status.open ? "" : closedMessage(),
  };
}
