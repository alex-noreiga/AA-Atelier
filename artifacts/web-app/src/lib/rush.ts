// The rush-order surcharge policy, in one place.
//
// A custom order counts as a "rush" when the customer's needed-by date falls
// inside the studio's rush window (sooner than the standard lead time). The
// order form then discloses that a surcharge applies and requires the customer
// to acknowledge it before submitting. The app never prices the fee itself — it
// records the rush flag on the order (a "Rush Order" checkbox + a page note) and
// the atelier adds a "Surcharge" invoice line, which flows into the balance.
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

// The customer-facing surcharge disclosure. Fee-agnostic by default (the atelier
// quotes the real amount); override with the actual policy, e.g. "a 15% rush
// surcharge".
export const RUSH_SURCHARGE_NOTE: string =
  import.meta.env.VITE_RUSH_SURCHARGE_NOTE ||
  "an additional rush surcharge, which we'll confirm with your quote";

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
