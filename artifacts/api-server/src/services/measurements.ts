// The set of body measurements an order carries, plus the "all present" check
// shared by the order-intake and measurement-change flows (both enforce the same
// values-or-appointment rule, so the field list lives in one place).

export const MEASUREMENT_FIELDS = [
  "waist",
  "bust",
  "hips",
  "height",
  "bodyGirth",
] as const;

export type MeasurementField = (typeof MEASUREMENT_FIELDS)[number];

/** True when every body measurement is present as a number. */
export function hasAllMeasurements(
  input: Partial<Record<MeasurementField, number | undefined>>,
): boolean {
  return MEASUREMENT_FIELDS.every((field) => typeof input[field] === "number");
}
