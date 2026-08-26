import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useCreateShopOrderReview,
  type ShopOrderItem,
} from "@workspace/api-client-react";
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
import { StarRatingInput } from "@/components/star-rating-input";
import {
  useRequestDialog,
  REQUEST_FORM_INPUT_CLASS,
  REQUEST_FORM_TEXTAREA_CLASS,
} from "@/hooks/use-request-dialog";
import { cn } from "@/lib/utils";

// Form schema. The mapped output is handed to `useCreateShopOrderReview`, whose
// `data` is typed as the generated `NewShopReviewRequest`, so the form can't
// silently drift from the API contract. `productId` starts empty and must be
// chosen — the server checks it against the order's own pieces, so the client's
// job here is only to make the choice easy, not to be the gate.
const formSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  productId: z.string().min(1, "Please choose which piece you're reviewing"),
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

/**
 * "Review your piece" — a review of one ready-to-wear item from a delivered shop
 * order.
 *
 * The sibling of {@link ReviewDialog}, and different in exactly one way: a shop
 * order can hold several pieces and a rating belongs to a piece, so the customer
 * says which one. With a single piece on the order that question answers itself
 * and the picker is a line of text rather than a choice to make.
 *
 * Rendered by the shop-order tracking result only once the order has reached its
 * final status and has pieces the shop can name — the same two things the server
 * requires, so the affordance and the gate agree.
 */
export function ShopReviewDialog({
  orderNumber,
  items,
}: {
  orderNumber: string;
  items: ShopOrderItem[];
}) {
  const single = items.length === 1 ? items[0] : undefined;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      rating: 0,
      consentToPublish: false,
      // Pre-chosen when there is nothing to choose between.
      productId: single?.id ?? "",
    },
  });

  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const rating = watch("rating");
  const productId = watch("productId");

  // 400 (the piece isn't on this order, or the order has no linked pieces), 403
  // (email mismatch) and 409 (not delivered, or cancelled) are expected,
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
  } = useRequestDialog({
    reset: () => {
      reset({
        rating: 0,
        consentToPublish: false,
        productId: single?.id ?? "",
      });
      setPhotoIds([]);
    },
    inlineStatuses: [400, 403, 409],
    toastTitle: "Couldn't submit your review",
  });

  const createReview = useCreateShopOrderReview({
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
        productId: values.productId,
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
        data-testid="button-review-piece"
      >
        <Star className="w-4 h-4" />
        <span>Review your piece</span>
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-lg max-h-[90vh] overflow-y-auto"
          data-testid="shop-review-dialog"
        >
          {submitted ? (
            <div className="py-6 text-center" data-testid="shop-review-success">
              <CheckCircle
                className="w-12 h-12 text-primary mx-auto mb-5"
                strokeWidth={1}
              />
              <DialogTitle className="font-serif text-2xl mb-2">
                Thank you
              </DialogTitle>
              <DialogDescription className="text-muted-foreground font-light">
                Your words help the next skater choose. We read every one before
                it goes on the site.
              </DialogDescription>
            </div>
          ) : (
            <>
              <DialogHeader className="text-left">
                <DialogTitle className="font-serif text-2xl flex items-center gap-2">
                  <Star className="w-4 h-4 text-primary" />
                  Review your piece
                </DialogTitle>
                <DialogDescription className="text-muted-foreground font-light">
                  {single ? (
                    <>
                      How is your{" "}
                      <span className="text-foreground">{single.name}</span>{" "}
                      wearing? Enter the email on order{" "}
                      <span className="text-foreground">{orderNumber}</span> to
                      leave a review.
                    </>
                  ) : (
                    <>
                      Tell us how one of the pieces from order{" "}
                      <span className="text-foreground">{orderNumber}</span> is
                      wearing. Enter the email on your order to leave a review.
                    </>
                  )}
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
                    data-testid="shop-review-error"
                  >
                    {formError}
                  </p>
                )}

                <div>
                  <Label
                    htmlFor="shop-review-email"
                    className="text-sm font-light tracking-wide"
                  >
                    Email on order <span className="text-primary">*</span>
                  </Label>
                  <Input
                    id="shop-review-email"
                    type="email"
                    autoFocus
                    {...register("email")}
                    placeholder="you@example.com"
                    data-testid="shop-review-email"
                    className={REQUEST_FORM_INPUT_CLASS}
                  />
                  {errors.email && (
                    <p className="text-destructive text-xs mt-1">
                      {errors.email.message}
                    </p>
                  )}
                </div>

                {/* With one piece on the order there is nothing to choose, so
                    it's stated rather than asked. */}
                {items.length > 1 && (
                  <div>
                    <Label className="text-sm font-light tracking-wide">
                      Which piece? <span className="text-primary">*</span>
                    </Label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() =>
                            setValue("productId", item.id, {
                              shouldValidate: true,
                            })
                          }
                          aria-pressed={productId === item.id}
                          data-testid={`shop-review-piece-${item.id}`}
                          className={cn(
                            "rounded-full border px-4 py-2 text-xs transition-colors",
                            productId === item.id
                              ? "border-primary text-primary"
                              : "border-border/60 text-muted-foreground hover:border-primary/50",
                          )}
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                    {errors.productId && (
                      <p className="text-destructive text-xs mt-1">
                        {errors.productId.message}
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <Label className="text-sm font-light tracking-wide">
                    Your rating <span className="text-primary">*</span>
                  </Label>
                  <StarRatingInput
                    value={rating}
                    onChange={(value) =>
                      setValue("rating", value, { shouldValidate: true })
                    }
                    idPrefix="shop-review-rating"
                  />
                  {errors.rating && (
                    <p className="text-destructive text-xs mt-1">
                      {errors.rating.message}
                    </p>
                  )}
                </div>

                <div>
                  <Label
                    htmlFor="shop-review-comment"
                    className="text-sm font-light tracking-wide"
                  >
                    Your review <span className="text-primary">*</span>
                  </Label>
                  <Textarea
                    id="shop-review-comment"
                    {...register("comment")}
                    placeholder="How does it fit? How does it hold up on the ice?"
                    rows={4}
                    data-testid="shop-review-comment"
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
                    htmlFor="shop-review-display-name"
                    className="text-sm font-light tracking-wide"
                  >
                    Credit me as
                    <span className="text-muted-foreground/60 ml-1 text-xs">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="shop-review-display-name"
                    {...register("displayName")}
                    placeholder="e.g. Ada L., or Ada from Chicago"
                    data-testid="shop-review-display-name"
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
                      helpText="Up to 3 photos of your piece (JPEG, PNG, WEBP, or GIF)."
                    />
                  </div>
                </div>

                <label
                  className="flex items-start gap-3 text-sm font-light text-foreground/80 cursor-pointer"
                  htmlFor="shop-review-consent"
                >
                  <input
                    id="shop-review-consent"
                    type="checkbox"
                    {...register("consentToPublish")}
                    data-testid="shop-review-consent"
                    className="mt-1 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span>
                    You may show my review, rating and photos beside this piece
                    in the shop and on social media.
                  </span>
                </label>

                <Button
                  type="submit"
                  disabled={createReview.isPending}
                  data-testid="shop-review-submit"
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
