import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateOrderMeasurements,
  getGetAccountOverviewQueryKey,
  type AccountMeasurements,
} from "@workspace/api-client-react";
import { Loader2, Ruler, PenLine, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MeasurementFields } from "@/components/measurement-fields";
import {
  MEASUREMENT_FIELDS,
  parseMeasurement,
  measurementFieldValue,
  type MeasurementUnit,
} from "@/lib/measurements";
import {
  requestErrorMessage,
  type RequestMutationError,
  REQUEST_FORM_TEXTAREA_CLASS,
} from "@/hooks/use-request-dialog";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  measurementUnit: z.enum(["inches", "cm"]).default("inches"),
  waist: z.string().optional(),
  bust: z.string().optional(),
  hips: z.string().optional(),
  height: z.string().optional(),
  bodyGirth: z.string().optional(),
  note: z.string().optional(),
});
// Unlike the tracking page's dialog there is no "measure me at a fitting"
// branch here, so all five are unconditionally required and the rule is a plain
// superRefine over every field rather than a mode-gated one.
const editSchema = formSchema.superRefine((values, ctx) => {
  for (const { key } of MEASUREMENT_FIELDS) {
    const raw = values[key];
    if (parseMeasurement(raw) === null) {
      ctx.addIssue({
        path: [key],
        code: z.ZodIssueCode.custom,
        message: raw?.trim() ? "Must be a positive number" : "Required",
      });
    }
  }
});

type FormInput = z.input<typeof editSchema>;
type FormValues = z.output<typeof editSchema>;

interface AccountMeasurementsProps {
  orderNumber: string;
  /** The email the overview was keyed on — the server's normalized copy, not
   * the browser's session claim, so the edit is verified against exactly the
   * address these orders were found by. */
  email: string;
  measurements: AccountMeasurements;
  /** Whether the values are shown but not editable. Two different reasons reach
   * it — the garment is being made, or the order is finished or cancelled — and
   * only the first is worth explaining, hence the separate flag below. */
  locked: boolean;
  /** True when the lock is the PRODUCTION lock specifically, which is the one
   * the customer benefits from being told about ("we're cutting to these now").
   * A finished or cancelled order is also uneditable, but saying "in
   * production" there would be plainly untrue, and its card already carries a
   * Delivered / Cancelled badge saying why. Derived server-side, since the lock
   * stage is a studio setting the browser never sees. */
  lockedInProduction?: boolean;
}

/**
 * The measurements on file for one custom order, with an in-place editor.
 *
 * Unlike the tracking page's dialog this one asks for no email — the customer
 * is signed in and the address is already known — so an edit here is two
 * clicks and a number. It is the same endpoint and the same gates: the session
 * is not what authorizes the write (`/orders/*` verifies the email in the body,
 * not a bearer token), it just means the customer doesn't have to type it.
 *
 * The form is seeded from the stored values rather than starting blank, which
 * is the whole point of editing in place: a customer correcting one waist
 * measurement shouldn't have to re-enter the other four, and a blank form
 * inviting a full retype is how the other four get retyped wrong.
 */
export function AccountMeasurementsBlock({
  orderNumber,
  email,
  measurements,
  locked,
  lockedInProduction = false,
}: AccountMeasurementsProps) {
  const [editing, setEditing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const rows: Array<[string, number | undefined]> = MEASUREMENT_FIELDS.map(
    ({ key, label }) => [label, measurements[key]],
  );
  const present = rows.filter(
    (row): row is [string, number] => typeof row[1] === "number",
  );

  const defaultValues: FormInput = {
    measurementUnit: measurements.unit,
    waist: measurementFieldValue(measurements.waist),
    bust: measurementFieldValue(measurements.bust),
    hips: measurementFieldValue(measurements.hips),
    height: measurementFieldValue(measurements.height),
    bodyGirth: measurementFieldValue(measurements.bodyGirth),
  };

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormInput, any, FormValues>({
    resolver: zodResolver(editSchema),
    defaultValues,
  });

  const unit = (watch("measurementUnit") ?? measurements.unit) as
    MeasurementUnit | undefined;

  const update = useUpdateOrderMeasurements({
    mutation: {
      onSuccess: (data) => {
        setEditing(false);
        setJustSaved(true);
        // The overview holds the stored measurements, so refetch rather than
        // patching the cache — an edit the server filed rather than applied
        // left them unchanged, and an optimistic patch would show numbers that
        // aren't on the order.
        queryClient.invalidateQueries({
          queryKey: getGetAccountOverviewQueryKey(),
        });
        if (data.outcome === "filed") {
          toast({
            title: "Sent to the atelier",
            description: `We couldn't apply these to ${orderNumber} automatically, so we've passed them to the atelier to apply.`,
          });
        }
      },
      onError: (error: RequestMutationError) =>
        toast({
          variant: "destructive",
          title: "Couldn't update your measurements",
          description: requestErrorMessage(error),
        }),
    },
  });

  const onSubmit = (values: FormValues) => {
    const note = values.note?.trim();
    update.mutate({
      orderNumber,
      data: {
        email,
        measurementUnit: values.measurementUnit,
        // The superRefine guarantees all five parse, so `?? 0` is unreachable.
        waist: parseMeasurement(values.waist) ?? 0,
        bust: parseMeasurement(values.bust) ?? 0,
        hips: parseMeasurement(values.hips) ?? 0,
        height: parseMeasurement(values.height) ?? 0,
        bodyGirth: parseMeasurement(values.bodyGirth) ?? 0,
        ...(note ? { note } : {}),
      },
    });
  };

  const cancel = () => {
    setEditing(false);
    reset(defaultValues);
  };

  // Nothing on file and nothing offered to add it — the intake never captured
  // these (a measure-at-fitting order), so an empty grid would say less than
  // saying nothing.
  if (present.length === 0 && locked) return null;

  return (
    <div className="mt-4 pt-4 border-t border-border/60">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="flex items-center gap-2 text-[11px] tracking-widest uppercase text-muted-foreground/70">
          <Ruler className="w-3 h-3" strokeWidth={1.5} />
          Measurements ({editing ? unit : measurements.unit})
        </p>
        {!editing &&
          (locked ? (
            lockedInProduction && (
              <span
                className="text-[11px] text-muted-foreground/60"
                data-testid={`measurements-locked-${orderNumber}`}
              >
                Locked — in production
              </span>
            )
          ) : (
            <button
              type="button"
              onClick={() => {
                setJustSaved(false);
                reset(defaultValues);
                setEditing(true);
              }}
              className="inline-flex items-center gap-1 text-[11px] tracking-widest uppercase text-primary hover:opacity-70 transition-opacity"
              data-testid={`measurements-edit-${orderNumber}`}
            >
              <PenLine className="w-3 h-3" strokeWidth={1.5} />
              {present.length === 0 ? "Add" : "Edit"}
            </button>
          ))}
        {!editing && justSaved && (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-primary"
            data-testid={`measurements-saved-${orderNumber}`}
          >
            <Check className="w-3 h-3" strokeWidth={1.5} />
            Saved
          </span>
        )}
      </div>

      {editing ? (
        <form
          noValidate
          onSubmit={handleSubmit(onSubmit)}
          className="mt-3"
          data-testid={`measurements-form-${orderNumber}`}
        >
          <MeasurementFields
            register={register}
            errors={errors}
            unit={(unit ?? measurements.unit) as MeasurementUnit}
            onUnitChange={(next) => setValue("measurementUnit", next)}
            idPrefix={`acct-measurements-${orderNumber}`}
          />

          <div className="mt-4">
            <Label
              htmlFor={`acct-measurements-${orderNumber}-note`}
              className="text-sm font-light tracking-wide"
            >
              Note
              <span className="text-muted-foreground/60 ml-1 text-xs">
                (optional)
              </span>
            </Label>
            <Textarea
              id={`acct-measurements-${orderNumber}-note`}
              {...register("note")}
              placeholder="Anything the atelier should know about this change..."
              rows={2}
              data-testid={`measurements-note-${orderNumber}`}
              className={REQUEST_FORM_TEXTAREA_CLASS}
            />
          </div>

          <div className="flex flex-wrap gap-3 mt-4">
            <Button
              type="submit"
              disabled={update.isPending}
              data-testid={`measurements-save-${orderNumber}`}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full tracking-widest uppercase text-[11px] px-5 disabled:opacity-50"
            >
              {update.isPending ? (
                <>
                  <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
            <button
              type="button"
              onClick={cancel}
              disabled={update.isPending}
              className="text-[11px] tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
              data-testid={`measurements-cancel-${orderNumber}`}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : present.length === 0 ? (
        <p className="text-sm text-muted-foreground/70">
          None on file yet — we'll take these at your fitting, or you can add
          them here.
        </p>
      ) : (
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
          {present.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-foreground tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
