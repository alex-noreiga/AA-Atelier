// Commission capacity: the pure rules behind "are the studio's books open?".
//
// A bespoke commission consumes weeks of the atelier's making time, so there is
// a real ceiling on how many can be in production at once. Past it, the honest
// thing is to stop taking orders and collect a waitlist — rather than accept a
// commission the studio then can't start for months, which is worse for the
// customer than being told to wait.
//
// Everything here is pure and synchronous: the decision (`resolveIntake`) takes
// the count and the settings as arguments, so it is unit-testable without Notion
// and cannot itself fail. `capacity.service.ts` supplies the count.
//
// Three things about this shape are load-bearing:
//
//   * **It fails OPEN, everywhere.** No cap set, an unreadable order count, a
//     count the caller couldn't produce — all report open. Every other degrade
//     in this app picks the cautious direction; here the cautious direction is
//     to keep taking orders, because closing the books on a Notion blip turns
//     away a paying customer silently and they do not come back to check.
//   * **The manual switch OVERRIDES the count in both directions.** The atelier
//     knows things the count doesn't — a commission that turned out to be three
//     garments, a month they are away. `closed` shuts the books under any count
//     and `open` reopens them over one, so the number is never the last word.
//   * **The two settings are business tunables, not access control**, so they
//     live in Studio Settings like the rush rate: the atelier changes them on
//     the dashboard, and they still resolve Notion -> env -> default.

import { settingValue } from "../lib/settings/store.js";

/** The atelier's manual switch, in force over any counted capacity. */
export type IntakeSwitch = "auto" | "open" | "closed";

/** Why the books are in the state they're in — for the studio panel and logs,
 * never for the customer (who is told `message`, not the mechanism). */
export type IntakeReason =
  /** No cap configured, so capacity is not being enforced at all. */
  | "unlimited"
  /** Under the cap. */
  | "under-capacity"
  /** At or over the cap. */
  | "at-capacity"
  /** The atelier forced the books open. */
  | "forced-open"
  /** The atelier closed the books by hand. */
  | "forced-closed"
  /** The count couldn't be read; open by default. */
  | "unknown";

export interface IntakeStatus {
  open: boolean;
  reason: IntakeReason;
}

/** The wording shown to a customer when nothing has been set. Deliberately says
 * what happens next — a closed sign with no next step reads as "go elsewhere". */
export const DEFAULT_CLOSED_MESSAGE =
  "Our books are full for the current season. Join the waitlist and we'll be in touch the moment a space opens up.";

const DEFAULT_CAPACITY = 0;

/**
 * How many commissions the atelier can have in production at once, from the
 * `COMMISSION_CAPACITY` Studio Setting (then the env var, then the default).
 *
 * **`0` means no cap** — and it is the default, so an atelier that has never
 * heard of this feature is never closed by it. A negative or unparseable value
 * reads as `0` for the same reason: an unusable value must not close the books.
 */
export function commissionCapacity(): number {
  const raw =
    settingValue("COMMISSION_CAPACITY") ?? process.env.COMMISSION_CAPACITY;
  if (raw === undefined || raw === "") return DEFAULT_CAPACITY;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_CAPACITY;
}

/**
 * The atelier's manual override, from `COMMISSION_INTAKE`. Anything that isn't
 * `open` or `closed` — including a typo — reads as `auto`, which is the
 * count-driven behaviour rather than a state of its own, so a mistyped value
 * can't accidentally shut the books.
 */
export function intakeSwitch(): IntakeSwitch {
  const raw = (
    settingValue("COMMISSION_INTAKE") ??
    process.env.COMMISSION_INTAKE ??
    ""
  )
    .trim()
    .toLowerCase();
  if (raw === "open" || raw === "closed") return raw;
  return "auto";
}

/** The customer-facing explanation shown when the books are closed. */
export function closedMessage(): string {
  const raw =
    settingValue("COMMISSION_CLOSED_MESSAGE") ??
    process.env.COMMISSION_CLOSED_MESSAGE;
  return raw?.trim() || DEFAULT_CLOSED_MESSAGE;
}

/**
 * Decide whether the books are open.
 *
 * `openCommissions` is how many capacity-gated orders are currently in
 * production, or `undefined` when that couldn't be counted — which is a
 * different thing from zero and is treated as "don't enforce" rather than
 * "plenty of room", so the reason reported stays honest.
 */
export function resolveIntake(
  openCommissions: number | undefined,
  { capacity, override }: { capacity: number; override: IntakeSwitch },
): IntakeStatus {
  // The switch is checked first: it is the atelier saying so, and nothing the
  // count says should be able to talk them out of it.
  if (override === "closed") return { open: false, reason: "forced-closed" };
  if (override === "open") return { open: true, reason: "forced-open" };
  if (capacity <= 0) return { open: true, reason: "unlimited" };
  if (openCommissions === undefined) return { open: true, reason: "unknown" };
  return openCommissions >= capacity
    ? { open: false, reason: "at-capacity" }
    : { open: true, reason: "under-capacity" };
}
