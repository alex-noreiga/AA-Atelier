import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

// Shared scaffolding for the customer "request" dialogs (cancellation,
// measurement-change, review, return/exchange). They all drive a generated
// mutation the same way: open/submitted/error state, the same error-envelope
// parsing, the same "expected statuses inline, everything else as a toast"
// routing, and the same reset-on-close. Only the field set + which statuses are
// "expected" differ, so those are the two knobs below.

/** Shape of a react-query mutation error from the generated client: an HTTP
 * status plus the parsed body, which is either an `ErrorEnvelope { error }`
 * (400/403/409/500) or an `OrderNotFound { message }` (404). */
export interface RequestMutationError {
  status?: number;
  data?: { error?: string; message?: string };
  message?: string;
}

/** Read the human message off a mutation error, whichever envelope shape it is. */
export function requestErrorMessage(error: RequestMutationError): string {
  const data = error.data;
  return (
    (data && ("error" in data ? data.error : data.message)) ||
    error.message ||
    "Something went wrong. Please try again."
  );
}

interface UseRequestDialogOptions {
  /** The react-hook-form `reset`, called when the dialog closes. */
  reset: () => void;
  /** HTTP statuses shown inline in the form (expected, actionable outcomes —
   * e.g. 403 email mismatch, 409 already delivered) rather than as a toast. */
  inlineStatuses: number[];
  /** Toast title for unexpected errors. */
  toastTitle: string;
}

/**
 * Owns the open/submitted/error state, the error handler, and the reset-on-close
 * for a request dialog. `submitted` is generic: the boolean dialogs leave `S`
 * defaulted, the ones that show a variant on success pass their payload type
 * (e.g. `{ exchange: boolean }`). It starts null (closed/unsubmitted).
 */
export function useRequestDialog<S = true>({
  reset,
  inlineStatuses,
  toastTitle,
}: UseRequestDialogOptions) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState<S | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleError = (error: RequestMutationError) => {
    const message = requestErrorMessage(error);
    if (error.status !== undefined && inlineStatuses.includes(error.status)) {
      setFormError(message);
    } else {
      setFormError(null);
      toast({
        variant: "destructive",
        title: toastTitle,
        description: message,
      });
    }
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

  return {
    open,
    setOpen,
    submitted,
    setSubmitted,
    formError,
    setFormError,
    handleError,
    onOpenChange,
  };
}

/** The underlined single-line input styling shared by the request-dialog fields. */
export const REQUEST_FORM_INPUT_CLASS =
  "mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none";

/** The bordered multi-line textarea styling shared by the request-dialog fields. */
export const REQUEST_FORM_TEXTAREA_CLASS =
  "mt-1.5 bg-transparent border border-border rounded-lg px-3 py-2 text-sm focus-visible:ring-0 focus-visible:border-primary transition-colors resize-none shadow-none";
