// The measurement production-lock rule, shared by the measurement-change
// use-case (which rejects a change once locked) and the order-status use-case
// (which tells the UI to hide the change affordance once locked), so the two
// can never disagree about when measurements are frozen.

// A targeted business rule naming one live Stage option — the first stage at
// which the garment is being physically made and measurements are frozen. This
// names a value, not the stage list (which stays live-read from Notion), so it
// is the same kind of deliberate exception as `STATUS_IN_STOCK`: if the atelier
// renames this stage in Notion, update it here (or set the env override).
const DEFAULT_LOCK_FROM_STAGE = "Cutting/Pinning";

export function lockFromStage(): string {
  return (
    process.env.MEASUREMENT_LOCK_FROM_STAGE?.trim() || DEFAULT_LOCK_FROM_STAGE
  );
}

/** True when the order's current stage is at or past the production lock point.
 * If either stage is absent from the live list (a renamed/removed option) we
 * fail open and report unlocked — a human vets the change request, and this
 * matches the codebase's graceful-degradation philosophy for live-read stage
 * data. */
export function measurementsLocked(
  currentStage: string,
  stages: string[],
): boolean {
  const thresholdIndex = stages.indexOf(lockFromStage());
  const currentIndex = stages.indexOf(currentStage);
  if (thresholdIndex === -1 || currentIndex === -1) {
    return false;
  }
  return currentIndex >= thresholdIndex;
}
