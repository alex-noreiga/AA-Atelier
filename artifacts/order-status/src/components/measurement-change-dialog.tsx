import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateMeasurementChangeRequest } from "@workspace/api-client-react";
import { CheckCircle, Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { useToast } from "@/hooks/use-toast";

const MEASUREMENT_FIELDS = [
  { key: "waist", label: "Waist" },
  { key: "bust", label: "Bust" },
  { key: "hips", label: "Hips" },
  { key: "height", label: "Height" },
  { key: "bodyGirth", label: "Body Girth" },
] as const;

// Form-friendly schema. Measurements are optional inputs: the customer either
// enters all five ("self") or asks to be re-measured at a fitting
// ("appointment"). The inputs are only *required* in "self" mode, which a flat
// field schema can't express — hence the superRefine (mirrors order-form). The
// mapped output is handed to the `useCreateMeasurementChangeRequest` mutation
// below, whose `data` is typed as the generated `NewMeasurementChangeRequest`,
// so the form can't silently drift from the API contract.
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
      const num = Number(raw);
      if (!raw || Number.isNaN(num) || num <= 0) {
        ctx.addIssue({
          path: [key],
          code: z.ZodIssueCode.custom,
          message:
            raw && !Number.isNaN(num) ? "Must be a positive number" : "Required",
        });
      }
    }
  });

type FormValues = z.infer<typeof formSchema>;

interface MeasurementChangeDialogProps {
  orderNumber: string;
}

/**
 * "Request a measurement change" — the customer either submits updated
 * measurements or asks to be re-measured at a fitting; the request lands in the
 * atelier's Notion inbox for a human to apply (Approach A; this never edits the
 * order directly). The server verifies the supplied email against the order
 * (403 on mismatch) and refuses once the garment is in production (409), which
 * we surface inline.
 */
export function MeasurementChangeDialog({
  orderNumber,
}: MeasurementChangeDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState<{ appointment: boolean } | null>(
    null,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const { toast } = useToast();

  const createRequest = useCreateMeasurementChangeRequest({
    mutation: {
      onSuccess: (_data, variables) =>
        setSubmitted({
          appointment: variables.data.measurementAppointment === true,
        }),
      onError: (error) => {
        // error.data is ErrorEnvelope { error } (400/403/409/500) or
        // OrderNotFound { message } (404) — read whichever field is present.
        const data = error.data;
        const message =
          (data && ("error" in data ? data.error : data.message)) ||
          error.message ||
          "Something went wrong. Please try again.";
        // 403 (email mismatch) and 409 (locked in production) are expected,
        // actionable outcomes — show them in the form. Anything else is
        // unexpected, so raise a toast as the other flows do.
        if (error.status === 403 || error.status === 409) {
          setFormError(message);
        } else {
          setFormError(null);
          toast({
            variant: "destructive",
            title: "Couldn't submit your request",
            description: message,
          });
        }
      },
    },
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { measurementMode: "self", measurementUnit: "inches" },
  });

  const measurementMode = watch("measurementMode");
  const measurementUnit = watch("measurementUnit");

  const onSubmit = (values: FormValues) => {
    setFormError(null);
    const { email, note } = values;
    // Either supply the measurements, or flag the re-measure appointment —
    // never both. (The superRefine guarantees "self" has all five present.)
    const measurements =
      values.measurementMode === "appointment"
        ? { measurementAppointment: true }
        : {
            measurementUnit: values.measurementUnit,
            waist: Number(values.waist),
            bust: Number(values.bust),
            hips: Number(values.hips),
            height: Number(values.height),
            bodyGirth: Number(values.bodyGirth),
          };
    createRequest.mutate({
      orderNumber,
      // Omit an empty note so the server never receives an empty string.
      data: { email, ...measurements, ...(note?.trim() ? { note: note.trim() } : {}) },
    });
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      // Closing discards the previous attempt, so reopening starts clean.
      setSubmitted(null);
      setFormError(null);
      reset();
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-2 text-sm tracking-widest uppercase group"
        data-testid="button-request-measurement-change"
      >
        <PenLine className="w-4 h-4" />
        <span>Request a measurement change</span>
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-lg max-h-[90vh] overflow-y-auto"
          data-testid="measurement-change-dialog"
        >
          {submitted ? (
            <div
              className="py-6 text-center"
              data-testid="measurement-change-success"
            >
              <CheckCircle
                className="w-12 h-12 text-primary mx-auto mb-5"
                strokeWidth={1}
              />
              <DialogTitle className="font-serif text-2xl mb-2">
                Request received
              </DialogTitle>
              <DialogDescription className="text-muted-foreground font-light">
                {submitted.appointment ? (
                  <>
                    We'll be in touch to schedule a fitting to take your new
                    measurements for order{" "}
                    <span className="text-foreground">{orderNumber}</span>.
                  </>
                ) : (
                  <>
                    We've passed your updated measurements to the atelier for
                    order <span className="text-foreground">{orderNumber}</span>.
                    We'll be in touch to confirm.
                  </>
                )}
              </DialogDescription>
            </div>
          ) : (
            <>
              <DialogHeader className="text-left">
                <DialogTitle className="font-serif text-2xl flex items-center gap-2">
                  <PenLine className="w-4 h-4 text-primary" />
                  Request a measurement change
                </DialogTitle>
                <DialogDescription className="text-muted-foreground font-light">
                  Enter the email on order{" "}
                  <span className="text-foreground">{orderNumber}</span>, then
                  either update your measurements or ask to be re-measured. The
                  atelier will review and apply the change.
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
                    data-testid="measurement-change-error"
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
                    data-testid="measurement-change-email"
                    className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none"
                  />
                  {errors.email && (
                    <p className="text-destructive text-xs mt-1">
                      {errors.email.message}
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
                    <span className="text-xs tracking-[0.2em] uppercase text-muted-foreground">
                      Measurements
                    </span>
                    {measurementMode === "self" && (
                      <div className="flex gap-2">
                        {(["inches", "cm"] as const).map((unit) => (
                          <button
                            key={unit}
                            type="button"
                            onClick={() => setValue("measurementUnit", unit)}
                            className={`px-3 py-1 rounded-full text-xs tracking-wider border transition-all ${
                              measurementUnit === unit
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:border-primary/50"
                            }`}
                            data-testid={`measurement-change-unit-${unit}`}
                          >
                            {unit}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 mb-6">
                    {(
                      [
                        { mode: "self", label: "I'll enter new measurements" },
                        { mode: "appointment", label: "Re-measure at a fitting" },
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
                        className={`flex-1 px-4 py-3 rounded-lg text-sm tracking-wide border transition-all ${
                          measurementMode === mode
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                        data-testid={`measurement-change-mode-${mode}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {measurementMode === "self" ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {MEASUREMENT_FIELDS.map(({ key, label }) => (
                        <div key={key}>
                          <Label
                            htmlFor={`mc-${key}`}
                            className="text-sm font-light tracking-wide"
                          >
                            {label}
                            <span className="text-muted-foreground/60 ml-1 text-xs">
                              ({measurementUnit})
                            </span>
                          </Label>
                          <Input
                            id={`mc-${key}`}
                            type="number"
                            step="0.1"
                            min="0"
                            {...register(key)}
                            placeholder="0.0"
                            data-testid={`measurement-change-${key}`}
                            className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none"
                          />
                          {errors[key] && (
                            <p className="text-destructive text-xs mt-1">
                              {errors[key]?.message}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="border border-border rounded-lg p-6 bg-muted/20">
                      <p className="text-sm font-light text-foreground/90 leading-relaxed">
                        No problem — we'll take your measurements for you. We'll
                        reach out to schedule a fitting, or take them during your
                        next consultation.
                      </p>
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
                    data-testid="measurement-change-note"
                    className="mt-1.5 bg-transparent border border-border rounded-lg px-3 py-2 text-sm focus-visible:ring-0 focus-visible:border-primary transition-colors resize-none shadow-none"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={createRequest.isPending}
                  data-testid="measurement-change-submit"
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 py-6 rounded-full tracking-widest uppercase text-xs transition-all duration-300 disabled:opacity-50"
                >
                  {createRequest.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Submitting...
                    </>
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
