import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useCreateMeasurementChangeRequest,
  useUpdateOrderMeasurements,
} from "@workspace/api-client-react";
import { CalendarCheck, CheckCircle, Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CtaLink } from "@/components/cta";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MeasurementFields } from "@/components/measurement-fields";
import {
  MEASUREMENT_FIELDS,
  parseMeasurement,
  type MeasurementUnit,
} from "@/lib/measurements";
import {
  useRequestDialog,
  REQUEST_FORM_INPUT_CLASS,
  REQUEST_FORM_TEXTAREA_CLASS,
} from "@/hooks/use-request-dialog";

// Form-friendly schema. The inputs are only *required* in "self" mode, which a
// flat field schema can't express — hence the superRefine (mirrors order-form).
// The mapped output is handed to the generated mutations below, whose `data` is
// typed against the contract, so the form can't silently drift from it.
const formSchema = z
  .object({
    email: z.string().email("Please enter a valid email address"),
    measurementMode: z.enum(["self", "appointment"]).default("self"),
    measurementUnit: z.enum(["inches", "cm"]).default("inches"),
    waist: z.string().optional(),
    bust: z.string().optional(),
    hips: z.string().optional(),
    height: z.string().optional(),
    bodyGirth: z.string().optional(),
    note: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.measurementMode !== "self") return;
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

type FormInput = z.input<typeof formSchema>;
type FormValues = z.output<typeof formSchema>;

/** Which of the three things happened, so the success panel can say the true
 * one. `applied` and `filed` are the server's own two outcomes; `appointment`
 * is the other branch of the dialog entirely. */
type Outcome = "applied" | "filed" | "appointment";

interface MeasurementsDialogProps {
  orderNumber: string;
}

/**
 * "Update your measurements" — the tracking page's measurement affordance.
 *
 * The two branches do genuinely different things, which is why they are one
 * dialog rather than two buttons: entering values EDITS the order in place,
 * while asking to be re-measured at a fitting is a request for a service that
 * only a person can perform, so it still files into the atelier's inbox. From
 * the customer's side both are "my measurements need to change" and the choice
 * between them is about how, so making them modes of one question is what
 * stops the page offering two near-identical links.
 *
 * The server may answer an edit with `filed` — it couldn't write to the order
 * and passed the values to the atelier instead. That is reported honestly
 * rather than dressed up as a save: what the customer must know is whether the
 * numbers are already in force or waiting on a human.
 */
export function MeasurementsDialog({ orderNumber }: MeasurementsDialogProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormInput, any, FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { measurementMode: "self", measurementUnit: "inches" },
  });

  const measurementMode = watch("measurementMode");
  const measurementUnit = watch("measurementUnit") ?? "inches";

  // 403 (email mismatch) and 409 (locked in production) are expected,
  // actionable outcomes shown inline; anything else raises a toast.
  const {
    open,
    setOpen,
    submitted,
    setSubmitted,
    formError,
    setFormError,
    handleError,
    onOpenChange,
  } = useRequestDialog<{ outcome: Outcome }>({
    reset,
    inlineStatuses: [403, 409],
    toastTitle: "Couldn't update your measurements",
  });

  const updateMeasurements = useUpdateOrderMeasurements({
    mutation: {
      onSuccess: (data) => setSubmitted({ outcome: data.outcome }),
      onError: handleError,
    },
  });

  const createRequest = useCreateMeasurementChangeRequest({
    mutation: {
      onSuccess: () => setSubmitted({ outcome: "appointment" }),
      onError: handleError,
    },
  });

  const pending = updateMeasurements.isPending || createRequest.isPending;

  const onSubmit = (values: FormValues) => {
    setFormError(null);
    const note = values.note?.trim();

    if (values.measurementMode === "appointment") {
      createRequest.mutate({
        orderNumber,
        data: {
          email: values.email,
          measurementAppointment: true,
          ...(note ? { note } : {}),
        },
      });
      return;
    }

    // The superRefine guarantees all five parse in this mode, so the `?? 0`
    // below is unreachable — it exists only to satisfy the number type without
    // a non-null assertion.
    updateMeasurements.mutate({
      orderNumber,
      data: {
        email: values.email,
        measurementUnit: values.measurementUnit,
        waist: parseMeasurement(values.waist) ?? 0,
        bust: parseMeasurement(values.bust) ?? 0,
        hips: parseMeasurement(values.hips) ?? 0,
        height: parseMeasurement(values.height) ?? 0,
        bodyGirth: parseMeasurement(values.bodyGirth) ?? 0,
        ...(note ? { note } : {}),
      },
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-2 text-sm tracking-widest uppercase group"
        data-testid="button-update-measurements"
      >
        <PenLine className="w-4 h-4" />
        <span>Update your measurements</span>
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-lg max-h-[90vh] overflow-y-auto"
          data-testid="measurements-dialog"
        >
          {submitted ? (
            <div
              className="py-6 text-center"
              data-testid="measurements-success"
            >
              <CheckCircle
                className="w-12 h-12 text-primary mx-auto mb-5"
                strokeWidth={1}
              />
              <DialogTitle className="font-serif text-2xl mb-2">
                {submitted.outcome === "applied"
                  ? "Measurements updated"
                  : "Request received"}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground font-light">
                {submitted.outcome === "applied" ? (
                  <>
                    Your new measurements are now on order{" "}
                    <span className="text-foreground">{orderNumber}</span>, and
                    we've emailed you a copy. We'll work to these from here.
                  </>
                ) : submitted.outcome === "filed" ? (
                  <>
                    We've passed your measurements to the atelier for order{" "}
                    <span className="text-foreground">{orderNumber}</span>.
                    We'll confirm once they're applied.
                  </>
                ) : (
                  <>
                    We'll be in touch to schedule a fitting to take your new
                    measurements for order{" "}
                    <span className="text-foreground">{orderNumber}</span>.
                  </>
                )}
              </DialogDescription>
            </div>
          ) : (
            <>
              <DialogHeader className="text-left">
                <DialogTitle className="font-serif text-2xl flex items-center gap-2">
                  <PenLine className="w-4 h-4 text-primary" />
                  Update your measurements
                </DialogTitle>
                <DialogDescription className="text-muted-foreground font-light">
                  Enter the email on order{" "}
                  <span className="text-foreground">{orderNumber}</span>, then
                  either update your measurements or ask to be re-measured.
                  Changes take effect straight away, up until your garment is
                  cut.
                </DialogDescription>
              </DialogHeader>

              {/* noValidate: zod owns validation, so the browser's own bubble
                  can't pre-empt our inline messages. */}
              <form
                noValidate
                onSubmit={handleSubmit(onSubmit)}
                className="mt-2 space-y-6"
              >
                {formError && (
                  <p
                    className="text-destructive text-sm border-l-2 border-destructive/50 pl-3"
                    data-testid="measurements-error"
                  >
                    {formError}
                  </p>
                )}

                <div>
                  <Label
                    htmlFor="mc-email"
                    className="text-sm font-light tracking-wide"
                  >
                    Email on order <span className="text-primary">*</span>
                  </Label>
                  <Input
                    id="mc-email"
                    type="email"
                    autoFocus
                    {...register("email")}
                    placeholder="you@example.com"
                    data-testid="measurements-email"
                    className={REQUEST_FORM_INPUT_CLASS}
                  />
                  {errors.email && (
                    <p className="text-destructive text-xs mt-1">
                      {errors.email.message}
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex flex-col sm:flex-row gap-3 mb-6">
                    {(
                      [
                        { mode: "self", label: "I'll enter new measurements" },
                        {
                          mode: "appointment",
                          label: "Re-measure at a fitting",
                        },
                      ] as const
                    ).map(({ mode, label }) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() =>
                          setValue("measurementMode", mode, {
                            shouldValidate: true,
                          })
                        }
                        aria-pressed={measurementMode === mode}
                        className={`flex-1 px-4 py-3 rounded-lg text-sm tracking-wide border transition-all ${
                          measurementMode === mode
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                        data-testid={`measurements-mode-${mode}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {measurementMode === "self" ? (
                    <MeasurementFields
                      register={register}
                      errors={errors}
                      unit={measurementUnit as MeasurementUnit}
                      onUnitChange={(unit) => setValue("measurementUnit", unit)}
                      idPrefix="measurements"
                    />
                  ) : (
                    <div className="border border-border rounded-lg p-6 bg-muted/20">
                      <p className="text-sm font-light text-foreground/90 leading-relaxed">
                        No problem, we'll take your measurements for you. Book a
                        fitting now, or we'll reach out to schedule one when you
                        submit this request.
                      </p>
                      <CtaLink
                        to="/appointments?type=fitting"
                        variant="outline"
                        className="mt-5"
                        data-testid="measurements-book-fitting"
                      >
                        <CalendarCheck className="w-4 h-4" />
                        Book your fitting
                      </CtaLink>
                    </div>
                  )}
                </div>

                <div>
                  <Label
                    htmlFor="mc-note"
                    className="text-sm font-light tracking-wide"
                  >
                    Note
                    <span className="text-muted-foreground/60 ml-1 text-xs">
                      (optional)
                    </span>
                  </Label>
                  <Textarea
                    id="mc-note"
                    {...register("note")}
                    placeholder="Anything the atelier should know about this change..."
                    rows={3}
                    data-testid="measurements-note"
                    className={REQUEST_FORM_TEXTAREA_CLASS}
                  />
                </div>

                <Button
                  type="submit"
                  disabled={pending}
                  data-testid="measurements-submit"
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 py-6 rounded-full tracking-widest uppercase text-xs transition-all duration-300 disabled:opacity-50"
                >
                  {pending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : measurementMode === "self" ? (
                    "Save measurements"
                  ) : (
                    "Submit request"
                  )}
                </Button>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
