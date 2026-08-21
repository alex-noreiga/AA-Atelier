// The studio dashboard's customer-request queue, HTTP-agnostic.
//
// Six kinds of request have been captured into the shared "Website Contact
// Messages" inbox since each of those flows shipped, and the app has only ever
// WRITTEN them. Actioning one meant opening Notion, reading the row, and
// re-typing its order number into a tool on this dashboard — which is both a
// trip out of the surface the work happens on and the one way to point a refund
// at the wrong customer. This is the read half, and it carries the order number
// with it so nothing has to be re-typed.
//
// Three things this owns beyond "call Notion":
//
//  1. **Ordering the queue the way it is worked.** Open requests come back
//     OLDEST first (the repository asks Notion for them that way), because the
//     request that has waited longest is the one that owes an answer. The
//     closed list stays newest first — it is a record, not a queue.
//  2. **Degrading to the queue when the record can't be read.** The closed list
//     is a convenience; the open one is the feature. So a failure reading the
//     closed rows costs the atelier its undo history for that page load, not
//     its queue.
//  3. **Reading the row back before writing it**, so a request deleted in
//     Notion since the queue loaded is a 404 rather than a confusing write
//     error — the same shape as the review moderation write.

import {
  listOpenRequests,
  listClosedRequests,
  findRequestById,
  setRequestStage,
} from "../lib/notion/requests.repository.js";
import type {
  RequestState,
  StudioRequestRecord,
} from "../lib/notion/requests.schema.js";
import { logger } from "../lib/logger.js";
import { NotFoundError } from "../lib/errors.js";

/** The queue as the dashboard renders it. */
export async function getRequestQueue(): Promise<{
  open: StudioRequestRecord[];
  closed: StudioRequestRecord[];
  truncated: boolean;
}> {
  const [openQueue, closed] = await Promise.all([
    listOpenRequests(),
    // Best-effort: see the header. The open queue is what the panel is for.
    listClosedRequests().catch((err: unknown) => {
      logger.warn(
        { err },
        "Failed to read the closed customer requests; showing the open queue only",
      );
      return [] as StudioRequestRecord[];
    }),
  ]);

  return {
    open: openQueue.records,
    closed,
    truncated: openQueue.truncated,
  };
}

/**
 * Record one request's state — replied, closed, or back to the queue.
 *
 * The read before the write is what turns a row deleted in Notion into a 404
 * (a PATCH against a missing page answers 404 too, but the read also means a
 * request the atelier can no longer see is reported the same way whichever call
 * noticed first).
 */
export async function setRequestQueueState(
  requestId: string,
  state: RequestState,
): Promise<StudioRequestRecord> {
  const existing = await findRequestById(requestId);
  if (!existing) {
    throw new NotFoundError("That request no longer exists.");
  }

  const updated = await setRequestStage(requestId, state);
  if (!updated) {
    throw new NotFoundError("That request no longer exists.");
  }

  return updated;
}
