// The five body measurements, shared by every surface that asks for them: the
// intake form, the tracking page's editor, and the account portal's.
//
// The list lives here rather than being repeated per form because the label and
// the contract field disagree on one of them — `bust` is shown as "Chest", the
// neutralized wording the Notion property also uses — and a form that
// re-declared the pairing is a form that can mislabel it.

export const MEASUREMENT_FIELDS = [
  { key: "waist", label: "Waist" },
  // The contract field stays `bust`; only the visible label is neutral.
  { key: "bust", label: "Chest" },
  { key: "hips", label: "Hips" },
  { key: "height", label: "Height" },
  { key: "bodyGirth", label: "Body Girth" },
] as const;

export type MeasurementKey = (typeof MEASUREMENT_FIELDS)[number]["key"];

export const MEASUREMENT_UNITS = ["inches", "cm"] as const;
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];

/**
 * A measurement typed into a text input, as a number — or `null` when it isn't
 * a usable one.
 *
 * Blank, non-numeric and non-positive all collapse to the same answer on
 * purpose: each is a value the form must refuse, and every caller here refuses
 * them identically. `Number("")` being `0` rather than `NaN` is the trap this
 * exists to close — an empty field would otherwise validate as a real zero.
 */
export function parseMeasurement(raw: string | undefined): number | null {
  if (!raw || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Render a stored measurement back into an editable field. Numbers arrive from
 * the API as numbers and inputs want strings; an absent value becomes an empty
 * field rather than "undefined". */
export function measurementFieldValue(value: number | undefined): string {
  return typeof value === "number" ? String(value) : "";
}
