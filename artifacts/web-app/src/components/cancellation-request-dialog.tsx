import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useCreateOrderCancellationRequest,
  useCreateShopOrderCancellationRequest,
} from "@workspace/api-client-react";
import { CheckCircle, Loader2, XCircle } from "lucide-react";
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

// Form-friendly schema. Email is verified against the order server-side; the
// reason is optional context passed through to the atelier. The mapped output is
// handed to the cancellation mutation below, whose `data` is typed as the
// generated `NewCancellationRequest`, so the form can't drift from the contract.
const formSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  reason: z.string().max(2000).optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface CancellationRequestDialogProps {
  orderNumber: string;
  /** Which order flow this cancellation targets — picks the matching endpoint. */
  variant: "custom" | "shop";
}

/**
 * "Request cancellation" — the customer asks to cancel their order; the request
 * lands in the atelier's Notion inbox for a human to review and refund (this
 * never refunds or edits the order directly). The server verifies the supplied
 * email against the order (403 on mismatch) and, for custom orders, refuses once
 * the order has been delivered (409), which we surface inline.
 *
 * Both generated hooks are called unconditionally (React rules); only the one
 * matching `variant` is used — no conditional hooks.
 */
export function CancellationRequestDialog({
  orderNumber,
  variant,
}: CancellationRequestDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { toast } = useToast();

  const mutationOptions = {
    mutation: {
      onSuccess: () => setSubmitted(true),
      onError: (error: {
        status?: number;
        data?: { error?: string; message?: string };
        message?: string;
      }) => {
        // error.data is ErrorEnvelope { error } (400/403/409/500) or
        // OrderNotFound { message } (404) — read whichever field is present.
        const data = error.data;
        const message =
          (data && ("error" in data ? data.error : data.message)) ||
          error.message ||
          "Something went wrong. Please try again.";
        // 403 (email mismatch) and 409 (already delivered) are expected,
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
  };

  const customRequest = useCreateOrderCancellationRequest(mutationOptions);
  const shopRequest = useCreateShopOrderCancellationRequest(mutationOptions);
  const request = variant === "shop" ? shopRequest : customRequest;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  const onSubmit = (values: FormValues) => {
    setFormError(null);
    const { email, reason } = values;
    request.mutate({
      orderNumber,
      // Omit an empty reason so the server never receives an empty string.
      data: { email, ...(reason?.trim() ? { reason: reason.trim() } : {}) },
    });
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      // Closing discards the previous attempt, so reopening starts clean.
      setSubmitted(false);
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
        data-testid="button-request-cancellation"
      >
        <XCircle className="w-4 h-4" />
        <span>Request cancellation</span>
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-lg max-h-[90vh] overflow-y-auto"
          data-testid="cancellation-dialog"
        >
          {submitted ? (
            <div
              className="py-6 text-center"
              data-testid="cancellation-success"
            >
              <CheckCircle
                className="w-12 h-12 text-primary mx-auto mb-5"
                strokeWidth={1}
              />
              <DialogTitle className="font-serif text-2xl mb-2">
                Request received
              </DialogTitle>
              <DialogDescription className="text-muted-foreground font-light">
                We've passed your cancellation request for order{" "}
                <span className="text-foreground">{orderNumber}</span> to the
                atelier. We'll be in touch to confirm the next steps, and
                process any refund to your original payment method.
              </DialogDescription>
            </div>
          ) : (
            <>
              <DialogHeader className="text-left">
                <DialogTitle className="font-serif text-2xl flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-primary" />
                  Request cancellation
                </DialogTitle>
                <DialogDescription className="text-muted-foreground font-light">
                  Enter the email on order{" "}
                  <span className="text-foreground">{orderNumber}</span> to
                  request its cancellation. The atelier will review your request
                  and process any refund.
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
                    data-testid="cancellation-error"
                  >
                    {formError}
                  </p>
                )}

                <div>
                  <Label
                    htmlFor="cancel-email"
                    className="text-sm font-light tracking-wide"
                  >
                    Email on order <span className="text-primary">*</span>
                  </Label>
                  <Input
                    id="cancel-email"
                    type="email"
                    autoFocus
                    {...register("email")}
                    placeholder="you@example.com"
                    data-testid="cancellation-email"
                    className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none"
                  />
                  {errors.email && (
                    <p className="text-destructive text-xs mt-1">
                      {errors.email.message}
                    </p>
                  )}
                </div>

                <div>
                  <Label
                    htmlFor="cancel-reason"
                    className="text-sm font-light tracking-wide"
                  >
                    Reason
                    <span className="text-muted-foreground/60 ml-1 text-xs">
                      (optional)
                    </span>
                  </Label>
                  <Textarea
                    id="cancel-reason"
                    {...register("reason")}
                    placeholder="Anything the atelier should know about this cancellation..."
                    rows={3}
                    data-testid="cancellation-reason"
                    className="mt-1.5 bg-transparent border border-border rounded-lg px-3 py-2 text-sm focus-visible:ring-0 focus-visible:border-primary transition-colors resize-none shadow-none"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={request.isPending}
                  data-testid="cancellation-submit"
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 py-6 rounded-full tracking-widest uppercase text-xs transition-all duration-300 disabled:opacity-50"
                >
                  {request.isPending ? (
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
