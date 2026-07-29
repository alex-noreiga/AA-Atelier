// Rush-order surcharge pricing — the server side of the roadmap's "priced rush
// fee" (see the "Rush order surcharge" note in CLAUDE.md).
//
// A rush order (the `Rush Order` checkbox, set at intake) is billed a surcharge
// that the invoice line-item generator adds as ONE more priced line, so the fee
// is computed server-side and lands in Notion — keeping the invoice the single
// source of truth (the app never invents a total that diverges from Notion's
// Final Balance). The rate is a targeted business rule, env-overridable and read
// at call time (like `measurementsLocked()` / the appointment settings).

import { settingValue } from "../lib/settings/store.js";

const DEFAULT_RUSH_SURCHARGE_RATE = 0.15;

/**
 * The rush surcharge as a fraction of the itemized subtotal (default `0.15` =
 * 15%). Overridable via the "Studio Settings" Notion row `RUSH_SURCHARGE_RATE`,
 * then the env var of the same name (e.g. `0.2`); a missing, unparseable, or
 * negative value falls back to the default. `0` disables the surcharge.
 */
export function rushSurchargeRate(): number {
  const raw =
    settingValue("RUSH_SURCHARGE_RATE") ?? process.env.RUSH_SURCHARGE_RATE;
  if (raw === undefined || raw === "") return DEFAULT_RUSH_SURCHARGE_RATE;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_RUSH_SURCHARGE_RATE;
}

/** The customer-facing invoice line name, e.g. "Rush surcharge (15%)". */
export function rushSurchargeLineName(rate: number): string {
  const percent = +(rate * 100).toFixed(2);
  return `Rush surcharge (${percent}%)`;
}
