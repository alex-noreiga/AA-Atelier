import { Star } from "lucide-react";
import {
  useGetPublishedReviews,
  type PublishedReview,
} from "@workspace/api-client-react";
import { SectionHeader } from "@/components/section-header";

/** How many testimonials a strip shows. Kept small so the section reads as a
 * pull-quote rather than a review feed; the full history is the portfolio's
 * job, not a marketing page's. */
const TESTIMONIAL_LIMIT = 3;

/** "August 2026" — month and year only. A testimonial dated to the day reads
 * like a support ticket, and the exact day tells a prospective customer
 * nothing. Returns null for a missing or unparseable date, so the byline
 * simply omits it. */
function formatMonth(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** A 1–5 star row, with the numeric rating exposed to assistive tech (five
 * repeated icon labels would be noise). */
function Stars({ rating }: { rating: number }) {
  return (
    <div
      className="flex items-center gap-0.5 text-primary"
      role="img"
      aria-label={`${rating} out of 5 stars`}
      data-testid="testimonial-stars"
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

function Testimonial({ review }: { review: PublishedReview }) {
  const month = formatMonth(review.publishedAt);
  // A customer who left the credit blank asked not to be named, so the quote
  // stands unattributed rather than being invented a byline.
  const byline = [review.customerName, month].filter(Boolean).join(" · ");

  return (
    <figure
      className="border border-border/60 rounded-2xl p-8 flex flex-col"
      data-testid="testimonial"
    >
      <Stars rating={review.rating} />
      <blockquote className="mt-5 text-muted-foreground font-light leading-relaxed">
        {review.comment}
      </blockquote>
      {byline && (
        <figcaption className="mt-6 text-xs tracking-[0.2em] uppercase text-muted-foreground/70 font-light">
          {byline}
        </figcaption>
      )}
    </figure>
  );
}

interface TestimonialsProps {
  /** The section's kicker — lets each page introduce the strip in its own voice. */
  eyebrow?: string;
  /** The section heading. */
  title?: string;
  className?: string;
}

/**
 * The curated-testimonial strip shown on the home and about pages.
 *
 * Renders **nothing at all** while loading, on error, or when the atelier has
 * published no reviews yet. That is deliberate: testimonials are a garnish on
 * pages that must stand on their own, so an empty state ("no reviews yet") or a
 * loading skeleton would advertise the absence rather than hide it, and a
 * Notion outage would leave a hole mid-page. The section simply isn't there.
 */
export function Testimonials({
  eyebrow = "In Their Words",
  title = "From our skaters",
  className = "mt-24",
}: TestimonialsProps) {
  const { data } = useGetPublishedReviews({ limit: TESTIMONIAL_LIMIT });
  const reviews = data?.reviews ?? [];

  if (reviews.length === 0) return null;

  return (
    <section className={className} data-testid="testimonials">
      <SectionHeader eyebrow={eyebrow} title={title} />
      <div
        className={`grid gap-6 md:gap-8 ${
          reviews.length > 1 ? "sm:grid-cols-2" : ""
        } ${reviews.length > 2 ? "lg:grid-cols-3" : ""}`}
      >
        {reviews.map((review) => (
          <Testimonial key={review.id} review={review} />
        ))}
      </div>
    </section>
  );
}
