import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "wouter";
import { useListReviews, useCreateReview } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageShell } from "@/components/page-shell";
import { Seo } from "@/components/seo";
import { StarRatingDisplay, StarRatingInput } from "@/components/star-rating";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, Loader2, Quote } from "lucide-react";

// Form-friendly schema (friendly messages). Its output shape is handed to the
// `useCreateReview` mutation below, whose `data` is typed as the generated
// `NewReviewRequest`, so the form cannot silently drift from the API contract.
const formSchema = z.object({
  // Optional: custom-order customers enter their order number; shop customers
  // leave it blank and are verified by the email they ordered with.
  orderNumber: z.string().optional(),
  email: z.string().email("Please enter a valid email address"),
  name: z.string().min(1, "Your name is required"),
  rating: z
    .number({ invalid_type_error: "Please select a rating" })
    .int()
    .min(1, "Please select a rating")
    .max(5),
  title: z.string().optional(),
  body: z.string().min(1, "Please write your review"),
});

type FormValues = z.infer<typeof formSchema>;

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long" });
}

/** The published reviews, or the loading/empty states around them. */
function ReviewsList() {
  const { data, isLoading, isError } = useListReviews();
  const reviews = data?.reviews ?? [];

  if (isLoading) {
    return (
      <div className="mt-4 text-center" data-testid="reviews-loading">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary/60" />
      </div>
    );
  }

  // A failed load shouldn't dominate the page — the form below still works.
  if (isError) {
    return (
      <p
        className="mt-4 text-center font-light text-muted-foreground"
        data-testid="reviews-error"
      >
        We couldn't load reviews just now. Please try again in a moment.
      </p>
    );
  }

  if (reviews.length === 0) {
    return (
      <p
        className="mt-4 text-center font-light text-muted-foreground"
        data-testid="reviews-empty"
      >
        No reviews yet — be the first to share your experience.
      </p>
    );
  }

  return (
    <div className="mt-12 grid gap-6 sm:grid-cols-2" data-testid="reviews-list">
      {reviews.map((review) => (
        <figure
          key={review.id}
          className="flex flex-col rounded-2xl border border-border/60 p-6"
          data-testid={`review-${review.id}`}
        >
          <div className="mb-4 flex items-center justify-between">
            <StarRatingDisplay value={review.rating} />
            <Quote className="h-5 w-5 text-primary/30" strokeWidth={1.5} />
          </div>
          {review.title && (
            <h3 className="mb-2 font-serif text-xl text-foreground">
              {review.title}
            </h3>
          )}
          <blockquote className="flex-1 font-light leading-relaxed text-muted-foreground whitespace-pre-line">
            {review.body}
          </blockquote>
          <figcaption className="mt-5 text-sm text-foreground">
            {review.name}
            {formatDate(review.date) && (
              <span className="text-muted-foreground/70">
                {" "}
                · {formatDate(review.date)}
              </span>
            )}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export default function Reviews() {
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  const createReview = useCreateReview({
    mutation: {
      onSuccess: () => setSubmitted(true),
      onError: (error) => {
        const message =
          error.data?.error ||
          error.message ||
          "Something went wrong. Please try again.";
        toast({
          variant: "destructive",
          title: "Review couldn't be submitted",
          description: message,
        });
      },
    },
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { rating: 0 },
  });

  const rating = watch("rating");
  const submitting = createReview.isPending;

  const onSubmit = (values: FormValues) => {
    const { title, orderNumber, ...rest } = values;
    createReview.mutate({
      data: {
        ...rest,
        // Omit the order number for shop reviews (blank) so the server routes to
        // the email-matched shop verification instead of a custom-order lookup.
        ...(orderNumber && orderNumber.trim()
          ? { orderNumber: orderNumber.trim() }
          : {}),
        ...(title && title.trim() ? { title: title.trim() } : {}),
      },
    });
  };

  return (
    <PageShell align="top" noise={false}>
      <Seo
        title="Reviews | A.A Atelier"
        description="Read what customers say about their custom figure skating and dance costumes from A.A Atelier — and share your own experience."
        path="/reviews"
      />
      <div className="mx-auto max-w-4xl px-6 pt-24 pb-16">
        <div className="mb-10 text-center">
          <p className="mb-6 text-xs uppercase tracking-[0.35em] text-primary">
            A.A Atelier
          </p>
          <h1 className="mb-3 font-serif text-4xl text-foreground md:text-5xl">
            Reviews
          </h1>
          <p className="text-lg font-light text-muted-foreground">
            Kind words from the skaters and dancers we've dressed.
          </p>
        </div>

        <ReviewsList />

        {/* Leave a review */}
        <div className="mt-20 border-t border-border pt-14">
          {submitted ? (
            <div
              className="mx-auto max-w-lg text-center duration-700 animate-in fade-in zoom-in-95"
              data-testid="review-success"
            >
              <CheckCircle
                className="mx-auto mb-6 h-16 w-16 text-primary"
                strokeWidth={1}
              />
              <h2 className="mb-3 font-serif text-3xl">Thank You</h2>
              <p className="mb-8 font-light text-muted-foreground">
                We've received your review. It will appear here once we've had a
                chance to publish it.
              </p>
              <Link
                to="/"
                className="inline-flex items-center gap-2 text-sm uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
              >
                Back to home
              </Link>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl">
              <div className="mb-10 text-center">
                <h2 className="mb-2 font-serif text-3xl text-foreground">
                  Leave a Review
                </h2>
                <p className="font-light text-muted-foreground">
                  Reviews are open to past customers. For a custom commission,
                  enter your order number; if you bought from the shop, just use
                  the email you ordered with.
                </p>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <div>
                    <Label
                      htmlFor="orderNumber"
                      className="text-sm font-light tracking-wide"
                    >
                      Order number
                      <span className="ml-1 text-xs text-muted-foreground/60">
                        (shop orders: leave blank)
                      </span>
                    </Label>
                    <Input
                      id="orderNumber"
                      {...register("orderNumber")}
                      placeholder="ORD-XXXX-XXXX"
                      className="mt-1.5 rounded-none border-0 border-b border-border bg-transparent px-0 py-3 shadow-none transition-colors focus-visible:border-primary focus-visible:ring-0"
                    />
                    {errors.orderNumber && (
                      <p className="mt-1 text-xs text-destructive">
                        {errors.orderNumber.message}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label
                      htmlFor="email"
                      className="text-sm font-light tracking-wide"
                    >
                      Email <span className="text-primary">*</span>
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      {...register("email")}
                      placeholder="you@example.com"
                      className="mt-1.5 rounded-none border-0 border-b border-border bg-transparent px-0 py-3 shadow-none transition-colors focus-visible:border-primary focus-visible:ring-0"
                    />
                    {errors.email && (
                      <p className="mt-1 text-xs text-destructive">
                        {errors.email.message}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <Label
                    htmlFor="name"
                    className="text-sm font-light tracking-wide"
                  >
                    Name <span className="text-primary">*</span>
                  </Label>
                  <Input
                    id="name"
                    {...register("name")}
                    placeholder="The name to show with your review"
                    className="mt-1.5 rounded-none border-0 border-b border-border bg-transparent px-0 py-3 shadow-none transition-colors focus-visible:border-primary focus-visible:ring-0"
                  />
                  {errors.name && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.name.message}
                    </p>
                  )}
                </div>

                <div>
                  <Label className="text-sm font-light tracking-wide">
                    Rating <span className="text-primary">*</span>
                  </Label>
                  <div className="mt-2">
                    <StarRatingInput
                      value={rating}
                      onChange={(value) =>
                        setValue("rating", value, { shouldValidate: true })
                      }
                    />
                  </div>
                  {errors.rating && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.rating.message}
                    </p>
                  )}
                </div>

                <div>
                  <Label
                    htmlFor="title"
                    className="text-sm font-light tracking-wide"
                  >
                    Title
                    <span className="ml-1 text-xs text-muted-foreground/60">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="title"
                    {...register("title")}
                    placeholder="A short headline"
                    className="mt-1.5 rounded-none border-0 border-b border-border bg-transparent px-0 py-3 shadow-none transition-colors focus-visible:border-primary focus-visible:ring-0"
                  />
                </div>

                <div>
                  <Label
                    htmlFor="body"
                    className="text-sm font-light tracking-wide"
                  >
                    Your review <span className="text-primary">*</span>
                  </Label>
                  <Textarea
                    id="body"
                    {...register("body")}
                    placeholder="Tell us about your costume and your experience..."
                    rows={5}
                    className="mt-1.5 resize-none rounded-lg border border-border bg-transparent px-3 py-2 text-sm shadow-none transition-colors focus-visible:border-primary focus-visible:ring-0"
                  />
                  {errors.body && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.body.message}
                    </p>
                  )}
                </div>

                <div className="flex justify-center pt-2">
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="rounded-full bg-primary px-10 py-6 text-xs uppercase tracking-widest text-primary-foreground transition-all duration-300 hover:bg-primary/90 hover:shadow-[0_0_20px_rgba(209,156,151,0.2)] disabled:opacity-50"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      "Submit Review"
                    )}
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
