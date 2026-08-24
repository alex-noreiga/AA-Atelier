// Display helpers for the tracking page's fulfilment panel (`OrderFulfilment`
// on a custom or shop order). Pure and unit-tested, so the wording and the
// timezone handling can be checked without rendering the page.

import { formatDate } from "@/lib/format";

/**
 * When the customer should collect their order, rendered from the atelier's
 * `Pickup Time`.
 *
 * The two shapes Notion can hand back need different treatment, and getting it
 * wrong is a silently wrong answer rather than a visible error:
 *
 *  - a **datetime** (`2026-09-03T14:00:00-05:00`) is an instant, rendered in the
 *    studio's own zone so a customer travelling — or simply in another state —
 *    is told the time to turn up in the studio's terms, not their device's;
 *  - a **bare date** (`2026-09-03`) is a calendar day with no instant behind it.
 *    Parsed as UTC midnight and formatted in a western zone it would slip to the
 *    day before, so it goes through {@link formatDate}, which pins it to UTC.
 *
 * Returns "" for a missing or unparseable value, so callers can fall back to
 * "we'll arrange a time" rather than printing "Invalid Date".
 */
export function formatPickupWhen(at?: string, timezone?: string): string {
  if (!at) return "";
  if (!at.includes("T")) return formatDate(at);

  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    ...(timezone ? { timeZone: timezone } : {}),
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

/** Normalize an atelier-authored option value for matching (see the server's
 * own `normalize` in `lib/fulfilment.ts` — same idea, same tolerance). */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/**
 * The atelier's `Fulfilment` state said in customer words — "Packed" is a column
 * value, "Packed and ready to send" is a sentence somebody wants to read. The
 * same state reads differently by method: a piece being collected is never "on
 * its way".
 *
 * Cosmetic only, and it **falls back to the atelier's own word** for a state
 * this map doesn't know (they can add options in Notion whenever they like) —
 * the same graceful-fallback contract as `stage-descriptions.ts`. It is never a
 * completion signal: the stage timeline above owns that, and the server drops
 * the state entirely once the order is delivered.
 */
export function fulfilmentStateNote(
  state: string | undefined,
  method: "ship" | "pickup",
): string {
  if (!state?.trim()) return "";
  const copy = STATE_COPY[normalize(state)];
  if (!copy) return state.trim();
  return copy[method];
}

const STATE_COPY: Record<string, { ship: string; pickup: string }> = {
  "to pack": {
    ship: "We're packing your order.",
    pickup: "We're getting your piece ready.",
  },
  packed: {
    ship: "Packed and ready to send.",
    pickup: "Packed and ready for you to collect.",
  },
  shipped: {
    ship: "On its way to you.",
    pickup: "On its way to you.",
  },
  "delivered picked up": {
    ship: "Delivered.",
    pickup: "Collected — thank you!",
  },
};
