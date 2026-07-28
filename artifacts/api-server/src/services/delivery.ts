// The "order is delivered" rule, shared by the review use-case (which only
// accepts a review once the order is delivered) and available to any other flow
// that needs the same test, so they can never disagree about when an order is
// considered complete.
//
// "Delivered" is derived purely positionally: the order's current stage is the
// last stage in the live, ordered stage list. This mirrors how the production
// schedule treats the final stage as delivered/complete (see
// `schedule.service.ts`), and — crucially — bakes in no stage name, so it keeps
// working when the atelier renames or reorders stages in Notion.

/** True when the order's current stage is the final stage in the live list.
 * Fails closed (not delivered) when the stage list is empty or the current
 * stage isn't in it (a renamed/removed option) — an unknown position can't be
 * confirmed as the end, and a review is a one-way action we'd rather withhold
 * than grant on a stale read. */
export function orderDelivered(
  currentStage: string,
  stages: string[],
): boolean {
  if (stages.length === 0) return false;
  return stages.indexOf(currentStage) === stages.length - 1;
}
