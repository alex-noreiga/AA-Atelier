import { Link } from "wouter";
import { ArrowRight, PenLine, Search } from "lucide-react";
import { useListReviews } from "@workspace/api-client-react";
import { PageShell } from "@/components/page-shell";
import { Seo } from "@/components/seo";
import { StarRatingDisplay } from "@/components/star-rating";

/**
 * A small strip of recent reviews to build trust on the landing page. Renders
 * nothing until there are published reviews (or while loading / on error), so
 * the hero is undisturbed when the site is new.
 */
function ReviewsHighlight() {
  const { data } = useListReviews();
  const reviews = (data?.reviews ?? []).slice(0, 3);
  if (reviews.length === 0) return null;

  return (
    <div
      className="mt-20 w-full max-w-4xl"
      data-testid="home-reviews-highlight"
    >
      <p className="mb-8 text-center text-xs uppercase tracking-[0.3em] text-muted-foreground">
        Kind words
      </p>
      <div className="grid gap-6 sm:grid-cols-3">
        {reviews.map((review) => (
          <figure
            key={review.id}
            className="flex flex-col rounded-2xl border border-border/60 p-6 text-left"
          >
            <StarRatingDisplay value={review.rating} className="mb-3" />
            <blockquote className="flex-1 text-sm font-light leading-relaxed text-muted-foreground line-clamp-4">
              {review.body}
            </blockquote>
            <figcaption className="mt-4 text-sm text-foreground">
              {review.name}
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="mt-8 text-center">
        <Link
          to="/reviews"
          className="group inline-flex items-center gap-2 text-xs uppercase tracking-widest text-primary transition-all hover:gap-3"
        >
          Read all reviews
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <PageShell>
      <Seo
        title="Custom Figure Skating & Dance Costumes | A.A Atelier"
        description="A.A Atelier crafts custom, made-to-measure figure skating and dance costumes by hand — from first sketch to final stitch. Begin a commission or track your order."
        path="/"
      />
      <div className="w-full max-w-2xl z-10 mx-auto text-center animate-in fade-in zoom-in-95 duration-1000">
        {/* Eyebrow */}
        <p className="text-primary text-xs tracking-[0.35em] uppercase mb-8">
          A Custom Figure Skating Costume Atelier
        </p>

        {/* Hero */}
        <h1 className="text-5xl md:text-7xl font-serif text-foreground leading-[1.05] mb-8">
          Costumes made
          <br />
          <span className="italic text-primary">just for you</span>
        </h1>

        <p className="text-muted-foreground font-light text-lg md:text-xl max-w-xl mx-auto mb-14 leading-relaxed">
          From first sketch to final stitch, we craft one-of-a-kind pieces by
          hand. Begin a new commission, or follow your costume's journey through
          our atelier.
        </p>

        {/* Primary actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            to="/order"
            className="group inline-flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-4 rounded-full tracking-widest uppercase text-xs transition-all duration-300 hover:shadow-[0_0_24px_rgba(209,156,151,0.25)]"
            data-testid="cta-place-order"
          >
            <PenLine className="w-4 h-4" />
            Place an Order
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
          <Link
            to="/shop/status"
            className="group inline-flex items-center gap-2 border border-border text-foreground hover:border-primary hover:text-primary px-8 py-4 rounded-full tracking-widest uppercase text-xs transition-all duration-300"
            data-testid="cta-order-status"
          >
            <Search className="w-4 h-4" />
            Track an Order
          </Link>
        </div>

        <ReviewsHighlight />
      </div>

      {/* Footer whisper */}
      <div className="absolute bottom-6 inset-x-0 z-10 text-center">
        <p className="text-muted-foreground/50 text-xs tracking-[0.2em] uppercase font-light">
          Bespoke · Handcrafted · Made to measure
        </p>
      </div>
    </PageShell>
  );
}
