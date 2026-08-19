// The rush-order surcharge policy, in one place.
//
// A custom order counts as a "rush" when the customer's needed-by date falls
// inside the studio's rush window (sooner than the standard lead time). The
// order form then discloses that a surcharge applies and requires the customer
// to acknowledge it before submitting, and the order records a rush flag (a
// "Rush Order" checkbox + a page note). The fee itself is priced server-side:
// the invoice line-item generator appends a "Surcharge" line at
// RUSH_SURCHARGE_RATE of the garment subtotal, which flows into the balance.
//
// Both knobs are build-time overridable (Vite env) so the atelier can retune the
// window and the disclosure copy without a code change; the defaults apply when
// unset. This mirrors the server's env-tuned business rules (measurement-lock,
// appointment settings).

const DEFAULT_RUSH_WINDOW_DAYS = 21;

/** Orders needed sooner than this many days out are treated as rush orders. */
export const RUSH_WINDOW_DAYS = (() => {
  const raw = import.meta.env.VITE_RUSH_WINDOW_DAYS;
  const parsed = Number(raw);
  return raw && Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_RUSH_WINDOW_DAYS;
})();

// The customer-facing surcharge disclosure. Defaults to the studio's 15% policy
// (the server prices the same fee onto the invoice — `RUSH_SURCHARGE_RATE`, also
// 15% by default); override with `VITE_RUSH_SURCHARGE_NOTE` if the rate changes,
// e.g. "a 20% rush surcharge". Keep the two in step.
export const RUSH_SURCHARGE_NOTE: string =
  import.meta.env.VITE_RUSH_SURCHARGE_NOTE || "a 15% rush surcharge";

/**
 * True when a needed-by date (ISO `yyyy-mm-dd`) falls within the rush window
 * from today — i.e. sooner than the studio's standard lead time. A blank,
 * unparseable, or past date is never a rush (a past date is caught by the
 * form's own future-date rule).
 */
export function isRushNeededBy(
  neededBy: string | undefined,
  today: Date = new Date(),
): boolean {
  if (!neededBy) return false;
  const chosen = new Date(`${neededBy}T00:00:00`);
  if (Number.isNaN(chosen.getTime())) return false;

  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const cutoff = new Date(start);
  cutoff.setDate(cutoff.getDate() + RUSH_WINDOW_DAYS);

  return chosen >= start && chosen < cutoff;
}
