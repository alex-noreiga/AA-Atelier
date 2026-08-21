// The studio dashboard's review moderation queue.
//
// A review has been captured at delivery since review capture shipped — rating,
// testimonial, photographs of the finished piece — and then sat in Notion with
// `Status = New` until someone opened the database and promoted it by hand.
// Nothing on the site showed it until they did. This is that decision, made
// next to everything else the atelier runs from here.
//
// What the panel is responsible for, beyond two buttons:
//
//  - **Showing what the decision is made on.** The words, the stars, the
//    photographs, and who wrote them — including whether their email matched the
//    order, which is the one signal that a review might not be genuine.
//  - **Saying when publishing isn't available, before it's tried.** A customer
//    who didn't tick "you may publish this" can't be published by the atelier,
//    so the button is replaced by the reason rather than failing on press.
//  - **Being undoable.** Every decision can be sent back to the queue, so a
//    mis-click is one press to fix rather than a trip to Notion.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListStudioReviews,
  useSetStudioReviewStatus,
  getListStudioReviewsQueryKey,
  type StudioReview,
  type ReviewModerationStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { serverErrorMessage } from "@/lib/api-error";
import {
  Check,
  ExternalLink,
  Loader2,
  MessageSquareQuote,
  Star,
  Undo2,
  X,
} from "lucide-react";

export function StudioReviews() {
  const queue = useListStudioReviews({
    query: { queryKey: getListStudioReviewsQueryKey(), retry: false },
  });

  const pending = queue.data?.pending ?? [];
  const decided = queue.data?.decided ?? [];

  return (
    <section data-testid="panel-reviews">
      <h2 className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
        <MessageSquareQuote className="w-4 h-4" strokeWidth={1.5} />
        Reviews
        {pending.length > 0 && (
          <span
            className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] tracking-normal text-primary"
            data-testid="reviews-pending-count"
          >
            {pending.length} waiting
          </span>
        )}
      </h2>

      {queue.isLoading ? (
        <div className="py-8 flex justify-center" data-testid="reviews-loading">
          <Loader2
            className="w-5 h-5 animate-spin text-primary"
            strokeWidth={1}
          />
        </div>
      ) : queue.isError ? (
        <p
          className="text-sm text-muted-foreground font-light"
          data-testid="reviews-error"
        >
          {serverErrorMessage(queue.error) ??
            "We couldn't load the reviews just now."}
        </p>
      ) : (
        <div className="space-y-3">
          {pending.length === 0 && (
            <p
              className="text-sm text-muted-foreground font-light"
              data-testid="reviews-empty"
            >
              Nothing waiting. Every review that has come in has been decided
              on.
            </p>
          )}

          {pending.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}

          {decided.length > 0 && (
            <details className="pt-2" data-testid="reviews-decided">
              <summary className="cursor-pointer text-xs tracking-[0.15em] uppercase text-muted-foreground/80">
                Already decided ({decided.length})
              </summary>
              <div className="mt-3 space-y-3">
                {decided.map((review) => (
                  <ReviewCard key={review.id} review={review} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      <p className="mt-2 text-xs text-muted-foreground/80 font-light">
        A published review appears on the home and about pages within a few
        minutes.
        {queue.data?.truncated
          ? " Only the most recent reviews are listed here; older ones are in Notion."
          : ""}
      </p>
    </section>
  );
}

/** One review, with whichever decisions are open to it. */
function ReviewCard({ review }: { review: StudioReview }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const decide = useSetStudioReviewStatus();

  const set = (status: ReviewModerationStatus) => {
    setError(null);
    decide.mutate(
      { reviewId: review.id, data: { status } },
      {
        onSuccess: () =>
          void queryClient.invalidateQueries({
            queryKey: getListStudioReviewsQueryKey(),
          }),
        onError: (err) =>
          setError(
            serverErrorMessage(err) ?? "That decision couldn't be saved.",
          ),
      },
    );
  };

  const byline = [review.customerName, review.orderNumber, review.email]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      className="rounded-sm border border-border bg-card/40 p-4 sm:p-5"
      data-testid={`review-${review.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Stars rating={review.rating} />
          {byline && (
            <p className="mt-2 text-xs text-muted-foreground font-light break-all">
              {byline}
            </p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground/70 font-light">
            {formatSubmitted(review.submittedAt)}
          </p>
        </div>
        <StatusBadge review={review} />
      </div>

      {review.comment ? (
        <blockquote className="mt-4 text-sm text-foreground font-light leading-relaxed whitespace-pre-line">
          {review.comment}
        </blockquote>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground font-light italic">
          No testimonial was written — a rating only.
        </p>
      )}

      {review.photos.length > 0 && (
        <ul
          className="mt-4 flex flex-wrap gap-2"
          data-testid={`review-photos-${review.id}`}
        >
          {review.photos.map((url, index) => (
            <li key={url}>
              {/* Opens the full-size image; the URL is a short-lived Notion
                  link, so it is good for this page load and not to keep. */}
              <a href={url} target="_blank" rel="noreferrer">
                <img
                  src={url}
                  alt={`Photo ${index + 1} of the finished piece`}
                  className="h-20 w-20 rounded-sm border border-border object-cover sm:h-24 sm:w-24"
                  loading="lazy"
                />
              </a>
            </li>
          ))}
        </ul>
      )}

      <Flags review={review} />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {review.status !== "published" &&
          (review.consentToPublish ? (
            <Button
              size="sm"
              disabled={decide.isPending}
              onClick={() => set("published")}
              className="gap-1.5"
              data-testid={`review-publish-${review.id}`}
            >
              {decide.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <Check className="w-3.5 h-3.5" strokeWidth={2} />
              )}
              Publish
            </Button>
          ) : (
            <p
              className="text-xs text-muted-foreground font-light"
              data-testid={`review-no-consent-${review.id}`}
            >
              This customer didn&apos;t agree to their review being published,
              so it can&apos;t go on the site.
            </p>
          ))}

        {review.status !== "rejected" && (
          <Button
            variant="outline"
            size="sm"
            disabled={decide.isPending}
            onClick={() => set("rejected")}
            className="gap-1.5"
            data-testid={`review-reject-${review.id}`}
          >
            <X className="w-3.5 h-3.5" strokeWidth={2} />
            {review.status === "published" ? "Take down" : "Set aside"}
          </Button>
        )}

        {review.status !== "pending" && (
          <Button
            variant="ghost"
            size="sm"
            disabled={decide.isPending}
            onClick={() => set("pending")}
            className="gap-1.5 text-xs"
            data-testid={`review-requeue-${review.id}`}
          >
            <Undo2 className="w-3.5 h-3.5" strokeWidth={1.5} />
            Back to queue
          </Button>
        )}

        {review.notionUrl && (
          <a
            href={review.notionUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary sm:ml-auto"
            data-testid={`review-notion-${review.id}`}
          >
            <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.5} />
            Open in Notion
          </a>
        )}
      </div>

      {error && (
        <p
          className="mt-3 text-sm text-destructive"
          data-testid={`review-error-${review.id}`}
        >
          {error}
        </p>
      )}
    </article>
  );
}

/** The two things about a review that aren't its words: whether the customer
 * agreed to publication, and whether their email matched the order. Both are
 * shown only when they need attention — a consenting, verified review is the
 * ordinary case and says nothing. */
function Flags({ review }: { review: StudioReview }) {
  const flags: string[] = [];
  if (!review.emailVerified) {
    flags.push(
      "The email doesn't match one stored on the order — worth checking before this goes on the site.",
    );
  }
  if (
    review.status === "pending" &&
    review.rawStatus &&
    !isCaptureStatus(review.rawStatus)
  ) {
    flags.push(
      `Its status in Notion is "${review.rawStatus}", which isn't one this page sets — deciding here will replace it.`,
    );
  }
  if (flags.length === 0) return null;

  return (
    <ul
      className="mt-3 space-y-1 text-xs text-muted-foreground font-light"
      data-testid={`review-flags-${review.id}`}
    >
      {flags.map((flag) => (
        <li key={flag}>{flag}</li>
      ))}
    </ul>
  );
}

/** The status a freshly captured review carries. Only used to keep the flag
 * above quiet for the ordinary case; the server is what decides what a status
 * means. */
function isCaptureStatus(status: string): boolean {
  return status.trim().toLowerCase() === "new";
}

function StatusBadge({ review }: { review: StudioReview }) {
  const label =
    review.status === "published"
      ? "On the site"
      : review.status === "rejected"
        ? "Set aside"
        : "Waiting";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] tracking-[0.12em] uppercase ${
        review.status === "published"
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground"
      }`}
      data-testid={`review-status-${review.id}`}
    >
      {label}
    </span>
  );
}

/** A 1–5 star row, with the numeric rating exposed to assistive tech. */
function Stars({ rating }: { rating: number }) {
  return (
    <div
      className="flex items-center gap-0.5 text-primary"
      role="img"
      aria-label={`${rating} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          className={`w-4 h-4 ${
            rating >= value ? "fill-primary" : "fill-transparent opacity-30"
          }`}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

/** "Submitted August 1, 2026" — the day matters here, unlike on the public
 * testimonial strip, because it says how long a review has been waiting. */
function formatSubmitted(iso?: string): string {
  if (!iso) return "Submitted at an unknown time";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Submitted at an unknown time";
  return `Submitted ${date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })}`;
}
