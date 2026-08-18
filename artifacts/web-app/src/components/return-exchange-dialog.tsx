import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateReturnRequest } from "@workspace/api-client-react";
import { CheckCircle, Loader2, RotateCcw } from "lucide-react";
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
import {
  useRequestDialog,
  REQUEST_FORM_INPUT_CLASS,
  REQUEST_FORM_TEXTAREA_CLASS,
} from "@/hooks/use-request-dialog";

// The reason values mirror the OpenAPI `reason` enum; labels are the customer's
// wording. Keep the value list in step with `NewReturnRequest.reason` in the
// spec (the mapped output is handed to the mutation, whose `data` is typed as
// the generated `CreateReturnRequestBody`, so the form can't silently drift).
const REASONS = [
  { value: "wrong_size", label: "Wrong size / doesn't fit" },
  { value: "damaged", label: "Arrived damaged or defective" },
  { value: "not_as_expected", label: "Not as expected" },
  { value: "changed_mind", label: "Changed my mind" },
  { value: "other", label: "Other" },
] as const;

const KINDS = [
  { value: "return", label: "Return for a refund" },
  { value: "exchange", label: "Exchange for another item" },
] as const;

const formSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  kind: z.enum(["return", "exchange"]).default("return"),
  reason: z.enum([
    "wrong_size",
    "damaged",
    "not_as_expected",
    "changed_mind",
    "other",
  ]),
  items: z.string().optional(),
  exchangeFor: z.string().optional(),
  note: z.string().optional(),
});

type FormInput = z.input<typeof formSchema>;
type FormValues = z.output<typeof formSchema>;

interface ReturnExchangeDialogProps {
  orderNumber: string;
}

/**
 * "Request a return or exchange" — the customer picks a return or exchange, a
 * reason, and which item(s); the request lands in the atelier's Notion inbox for
 * a human to review and action (Approach A; this never refunds or edits the
 * order). The server verifies the supplied email against the order (403 on
 * mismatch), which we surface inline.
 */
export function ReturnExchangeDialog({
  orderNumber,
}: ReturnExchangeDialogProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormInput, any, FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { kind: "return", reason: "wrong_size" },
  });

  const kind = watch("kind");

  // 403 (email mismatch) is an expected, actionable outcome shown inline;
  // anything else raises a toast.
  const {
    open,
    setOpen,
    submitted,
    setSubmitted,
    formError,
    setFormError,
    handleError,
    onOpenChange,
  } = useRequestDialog<{ exchange: boolean }>({
    reset,
    inlineStatuses: [403],
    toastTitle: "Couldn't submit your request",
  });

  const createRequest = useCreateReturnRequest({
    mutation: {
      onSuccess: (_data, variables) =>
        setSubmitted({ exchange: variables.data.kind === "exchange" }),
      onError: handleError,
    },
  });

  const onSubmit = (values: FormValues) => {
    setFormError(null);
    const { email, kind, reason, items, exchangeFor, note } = values;
    createRequest.mutate({
      orderNumber,
      // Omit empty optional fields so the server never receives empty strings;
      // `exchangeFor` is only meaningful for an exchange.
      data: {
        email,
        kind,
        reason,
        ...(items?.trim() ? { items: items.trim() } : {}),
        ...(kind === "exchange" && exchangeFor?.trim()
          ? { exchangeFor: exchangeFor.trim() }
          : {}),
        ...(note?.trim() ? { note: note.trim() } : {}),
      },
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-2 text-sm tracking-widest uppercase group"
        data-testid="button-request-return"
      >
        <RotateCcw className="w-4 h-4" />
        <span>Request a return or exchange</span>
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-lg max-h-[90vh] overflow-y-auto"
          data-testid="return-exchange-dialog"
        >
          {submitted ? (
            <div
              className="py-6 text-center"
              data-testid="return-exchange-success"
            >
              <CheckCircle
                className="w-12 h-12 text-primary mx-auto mb-5"
                strokeWidth={1}
              />
              <DialogTitle className="font-serif text-2xl mb-2">
                Request received
              </DialogTitle>
              <DialogDescription className="text-muted-foreground font-light">
                We've received your {submitted.exchange ? "exchange" : "return"}{" "}
                request for order{" "}
                <span className="text-foreground">{orderNumber}</span>. We'll
                review it and be in touch with the next steps.
              </DialogDescription>
            </div>
          ) : (
            <>
              <DialogHeader className="text-left">
                <DialogTitle className="font-serif text-2xl flex items-center gap-2">
                  <RotateCcw className="w-4 h-4 text-primary" />
                  Request a return or exchange
                </DialogTitle>
                <DialogDescription className="text-muted-foreground font-light">
                  Enter the email on order{" "}
                  <span className="text-foreground">{orderNumber}</span>, then
                  tell us what you'd like to do. The atelier will review your
                  request and follow up.
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
                    data-testid="return-exchange-error"
                  >
                    {formError}
                  </p>
                )}

                <div>
                  <Label
                    htmlFor="re-email"
                    className="text-sm font-light tracking-wide"
                  >
                    Email on order <span className="text-primary">*</span>
                  </Label>
                  <Input
                    id="re-email"
                    type="email"
                    autoFocus
                    {...register("email")}
                    placeholder="you@example.com"
                    data-testid="return-exchange-email"
                    className={REQUEST_FORM_INPUT_CLASS}
                  />
                  {errors.email && (
                    <p className="text-destructive text-xs mt-1">
                      {errors.email.message}
                    </p>
                  )}
                </div>

                <div>
                  <span className="text-xs tracking-[0.2em] uppercase text-muted-foreground block mb-3">
                    What would you like to do?
                  </span>
                  <div className="flex flex-col sm:flex-row gap-3">
                    {KINDS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setValue("kind", value)}
                        className={`flex-1 px-4 py-3 rounded-lg text-sm tracking-wide border transition-all ${
                          kind === value
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                        data-testid={`return-exchange-kind-${value}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label
                    htmlFor="re-reason"
                    className="text-sm font-light tracking-wide"
                  >
                    Reason <span className="text-primary">*</span>
                  </Label>
                  <select
                    id="re-reason"
                    {...register("reason")}
                    data-testid="return-exchange-reason"
                    className="mt-1.5 w-full bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none text-sm"
                  >
                    {REASONS.map(({ value, label }) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label
                    htmlFor="re-items"
                    className="text-sm font-light tracking-wide"
                  >
                    Which item(s)?
                    <span className="text-muted-foreground/60 ml-1 text-xs">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="re-items"
                    {...register("items")}
                    placeholder="e.g. Bow Fleece Soaker — Black, size M"
                    data-testid="return-exchange-items"
                    className={REQUEST_FORM_INPUT_CLASS}
                  />
                </div>

                {kind === "exchange" && (
                  <div>
                    <Label
                      htmlFor="re-exchange-for"
                      className="text-sm font-light tracking-wide"
                    >
                      Exchange for
                      <span className="text-muted-foreground/60 ml-1 text-xs">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      id="re-exchange-for"
                      {...register("exchangeFor")}
                      placeholder="e.g. the same soaker in size L"
                      data-testid="return-exchange-exchange-for"
                      className={REQUEST_FORM_INPUT_CLASS}
                    />
                  </div>
                )}

                <div>
                  <Label
                    htmlFor="re-note"
                    className="text-sm font-light tracking-wide"
                  >
                    Note
                    <span className="text-muted-foreground/60 ml-1 text-xs">
                      (optional)
                    </span>
                  </Label>
                  <Textarea
                    id="re-note"
                    {...register("note")}
                    placeholder="Anything else the atelier should know..."
                    rows={3}
                    data-testid="return-exchange-note"
                    className={REQUEST_FORM_TEXTAREA_CLASS}
                  />
                </div>

                <Button
                  type="submit"
                  disabled={createRequest.isPending}
                  data-testid="return-exchange-submit"
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
