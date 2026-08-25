import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MEASUREMENT_FIELDS,
  MEASUREMENT_UNITS,
  type MeasurementUnit,
} from "@/lib/measurements";
import { REQUEST_FORM_INPUT_CLASS } from "@/hooks/use-request-dialog";

/** The subset of a form's values these fields drive. Both callers' schemas are
 * supersets of it (they add an email, a note, a mode), so the component is
 * typed against the shape it actually touches rather than either form's. */
export interface MeasurementFormValues {
  waist?: string;
  bust?: string;
  hips?: string;
  height?: string;
  bodyGirth?: string;
  measurementUnit?: MeasurementUnit;
}

interface MeasurementFieldsProps {
  register: UseFormRegister<any>;
  errors: FieldErrors<MeasurementFormValues>;
  unit: MeasurementUnit;
  onUnitChange: (unit: MeasurementUnit) => void;
  /** Prefixes the input ids and test ids, so two of these can coexist on one
   * page — the account dashboard renders one per custom order. */
  idPrefix: string;
}

/**
 * The five measurement inputs and their unit toggle, shared by the tracking
 * page's editor and the account portal's.
 *
 * The unit is part of this component rather than each form's own chrome because
 * it is what gives the five numbers meaning: a surface that offered the values
 * without it would be collecting a figure with no scale, which is the one way
 * these fields can be wrong without looking wrong.
 */
export function MeasurementFields({
  register,
  errors,
  unit,
  onUnitChange,
  idPrefix,
}: MeasurementFieldsProps) {
  return (
    <>
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
        <span className="text-xs tracking-[0.2em] uppercase text-muted-foreground">
          Measurements
        </span>
        <div className="flex gap-2" role="group" aria-label="Measurement unit">
          {MEASUREMENT_UNITS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onUnitChange(option)}
              aria-pressed={unit === option}
              className={`px-3 py-1 rounded-full text-xs tracking-wider border transition-all ${
                unit === option
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/50"
              }`}
              data-testid={`${idPrefix}-unit-${option}`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {MEASUREMENT_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <Label
              htmlFor={`${idPrefix}-${key}`}
              className="text-sm font-light tracking-wide"
            >
              {label}
              <span className="text-muted-foreground/60 ml-1 text-xs">
                ({unit})
              </span>
            </Label>
            <Input
              id={`${idPrefix}-${key}`}
              type="number"
              step="0.1"
              min="0"
              {...register(key)}
              placeholder="0.0"
              data-testid={`${idPrefix}-${key}`}
              className={REQUEST_FORM_INPUT_CLASS}
            />
            {errors[key] && (
              <p className="text-destructive text-xs mt-1">
                {errors[key]?.message as string}
              </p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
