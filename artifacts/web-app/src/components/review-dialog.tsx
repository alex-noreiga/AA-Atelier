import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateOrderReview } from "@workspace/api-client-react";
import { CheckCircle, Loader2, Star } from "lucide-react";
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
import { ReferenceImageUpload } from "@/components/reference-image-upload";
import {
  useRequestDialog,
  REQUEST_FORM_INPUT_CLASS,
  REQUEST_FORM_TEXTAREA_CLASS,
} from "@/hooks/use-request-dialog";

// Form schema. `rating` is set via the star buttons (not a text input), so it
// starts at 0 and must reach at least 1. The mapped output is handed to the
// `useCreateOrderReview` mutation, whose `data` is typed as the generated
// `NewReviewRequest`, so the form can't silently drift from the API contract.
const formSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  rating: z.number().min(1, "Please choose a star rating").max(5),
  comment: z
    .string()
    .trim()
    .min(1, "Please share a few words")
    .max(2000, "Please keep your review under 2000 characters"),
  displayName: z.string().max(120).optional(),
  consentToPublish: z.boolean().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface ReviewDialogProps {
  orderNumber: string;
}

/**
 * "Share your experience" — a post-delivery review of a finished custom order.
 * The customer leaves a star rating, a short testimonial, an optional credit
 * name, and photos of the finished piece; the review lands in the atelier's
 * Notion reviews database (default "New") to be curated into testimonials / the
 * portfolio. The server verifies the supplied email against the order (403 on
 * mismatch) and only accepts a review once the order is delivered (409), which
 * we surface inline. Rendered by the tracking page only for delivered orders.
 */
export function ReviewDialog({ orderNumber }: ReviewDialogProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { rating: 0, consentToPublish: false },
  });

  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const rating = watch("rating");

  // 403 (email mismatch) and 409 (not yet delivered) are expected, actionable
  // outcomes shown inline; anything else raises a toast.
  const {
    open,
    setOpen,
    submitted,
    setSubmitted,
    formError,
    setFormError,
    handleError,
    onOpenChange,
  } = useRequestDialog({
    reset: () => {
      reset({ rating: 0, consentToPublish: false });
      setPhotoIds([]);
    },
    inlineStatuses: [403, 409],
    toastTitle: "Couldn't submit your review",
  });

  const createReview = useCreateOrderReview({
    mutation: {
      onSuccess: () => setSubmitted(true),
      onError: handleError,
    },
  });

  const onSubmit = (values: FormValues) => {
    setFormError(null);
    createReview.mutate({
      orderNumber,
      data: {
        email: values.email,
        rating: values.rating,
        comment: values.comment.trim(),
        ...(values.displayName?.trim()
          ? { displayName: values.displayName.trim() }
          : {}),
        consentToPublish: values.consentToPublish ?? false,
        ...(photoIds.length > 0 ? { photoIds } : {}),
      },
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-2 text-sm tracking-widest uppercase group"
        data-testid="button-leave-review"
      >
        <Star className="w-4 h-4" />
        <span>Share your experience</span>
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-lg max-h-[90vh] overflow-y-auto"
          data-testid="review-dialog"
        >
          {submitted ? (
            <div className="py-6 text-center" data-testid="review-success">
              <CheckCircle
                className="w-12 h-12 text-primary mx-auto mb-5"
                strokeWidth={1}
              />
              <DialogTitle className="font-serif text-2xl mb-2">
                Thank you
              </DialogTitle>
              <DialogDescription className="text-muted-foreground font-light">
                Your review of order{" "}
                <span className="text-foreground">{orderNumber}</span> means the
                world to us. We're so glad your piece is finished and in your
                hands.
              </DialogDescription>
            </div>
          ) : (
            <>
              <DialogHeader className="text-left">
                <DialogTitle className="font-serif text-2xl flex items-center gap-2">
                  <Star className="w-4 h-4 text-primary" />
                  Share your experience
                </DialogTitle>
                <DialogDescription className="text-muted-foreground font-light">
                  Now that order{" "}
                  <span className="text-foreground">{orderNumber}</span> is in
                  your hands, we'd love to hear how it turned out. Enter the
                  email on your order to leave a review.
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
                    data-testid="review-error"
                  >
                    {formError}
                  </p>
                )}

                <div>
                  <Label
                    htmlFor="review-email"
                    className="text-sm font-light tracking-wide"
                  >
                    Email on order <span className="text-primary">*</span>
                  </Label>
                  <Input
                    id="review-email"
                    type="email"
                    autoFocus
                    {...register("email")}
                    placeholder="you@example.com"
                    data-testid="review-email"
                    className={REQUEST_FORM_INPUT_CLASS}
                  />
                  {errors.email && (
                    <p className="text-destructive text-xs mt-1">
                      {errors.email.message}
                    </p>
                  )}
                </div>

                <div>
                  <Label className="text-sm font-light tracking-wide">
                    Your rating <span className="text-primary">*</span>
                  </Label>
                  <div
                    className="mt-2 flex items-center gap-1"
                    role="radiogroup"
                    aria-label="Star rating"
                  >
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          setValue("rating", value, { shouldValidate: true })
                        }
                        aria-label={`${value} star${value === 1 ? "" : "s"}`}
                        aria-pressed={rating >= value}
                        data-testid={`review-rating-${value}`}
                        className="p-1 text-muted-foreground/40 hover:text-primary transition-colors"
                      >
                        <Star
                          className={`w-7 h-7 transition-colors ${
                            rating >= value
                              ? "fill-primary text-primary"
                              : "fill-transparent"
                          }`}
                          strokeWidth={1.5}
                        />
                      </button>
                    ))}
                  </div>
                  {errors.rating && (
                    <p className="text-destructive text-xs mt-1">
                      {errors.rating.message}
                    </p>
                  )}
                </div>

                <div>
                  <Label
                    htmlFor="review-comment"
                    className="text-sm font-light tracking-wide"
                  >
                    Your review <span className="text-primary">*</span>
                  </Label>
                  <Textarea
                    id="review-comment"
                    {...register("comment")}
                    placeholder="How does your finished piece feel? What was working with the atelier like?"
                    rows={4}
                    data-testid="review-comment"
                    className={REQUEST_FORM_TEXTAREA_CLASS}
                  />
                  {errors.comment && (
                    <p className="text-destructive text-xs mt-1">
                      {errors.comment.message}
                    </p>
                  )}
                </div>

                <div>
                  <Label
                    htmlFor="review-display-name"
                    className="text-sm font-light tracking-wide"
                  >
                    Credit me as
                    <span className="text-muted-foreground/60 ml-1 text-xs">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="review-display-name"
                    {...register("displayName")}
                    placeholder="e.g. Ada L., or Ada from Chicago"
                    data-testid="review-display-name"
                    className={REQUEST_FORM_INPUT_CLASS}
                  />
                </div>

                <div>
                  <Label className="text-sm font-light tracking-wide">
                    Photos of your piece
                    <span className="text-muted-foreground/60 ml-1 text-xs">
                      (optional)
                    </span>
                  </Label>
                  <div className="mt-2">
                    <ReferenceImageUpload
                      onChange={setPhotoIds}
                      disabled={createReview.isPending}
                      label="Add a photo"
                      max={3}
                      helpText="Up to 3 photos of your finished piece (JPEG, PNG, WEBP, or GIF)."
                    />
                  </div>
                </div>

                <label
                  className="flex items-start gap-3 text-sm font-light text-foreground/80 cursor-pointer"
                  htmlFor="review-consent"
                >
                  <input
                    id="review-consent"
                    type="checkbox"
                    {...register("consentToPublish")}
                    data-testid="review-consent"
                    className="mt-1 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span>
                    You may feature my review and photos on your website and
                    social media.
                  </span>
                </label>

                <Button
                  type="submit"
                  disabled={createReview.isPending}
                  data-testid="review-submit"
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 py-6 rounded-full tracking-widest uppercase text-xs transition-all duration-300 disabled:opacity-50"
                >
                  {createReview.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Submit review"
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
