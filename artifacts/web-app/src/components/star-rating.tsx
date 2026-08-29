import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A read-only star rating: five stars with the average filled in, and the count
 * it was built from.
 *
 * The count is not decoration. An average alone says nothing about how much
 * weight to put on it — "5.0" from one review reads very differently from "4.8"
 * from forty — so the two are always shown together and the component has no
 * option to drop it.
 *
 * Half-filled stars are done with a clipped overlay rather than a half-star
 * glyph, so 4.3 looks like 4.3 rather than being rounded to something the number
 * beside it contradicts.
 */
export function StarRating({
  average,
  count,
  className,
  size = "sm",
}: {
  average: number;
  count: number;
  className?: string;
  size?: "sm" | "md";
}) {
  const star = size === "md" ? "w-4 h-4" : "w-3.5 h-3.5";
  const clamped = Math.max(0, Math.min(5, average));

  return (
    <div
      className={cn("flex items-center gap-2", className)}
      data-testid="star-rating"
    >
      <span
        className="relative inline-flex"
        role="img"
        aria-label={`Rated ${average} out of 5 from ${count} ${
          count === 1 ? "review" : "reviews"
        }`}
      >
        <span className="flex text-muted-foreground/30" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} className={star} strokeWidth={1.5} />
          ))}
        </span>
        {/* The filled stars, clipped to the average's width and laid exactly
            over the empty ones. `overflow-hidden` on a percentage width is what
            gives a partial star its partial fill. */}
        <span
          className="absolute inset-0 flex overflow-hidden text-primary"
          style={{ width: `${(clamped / 5) * 100}%` }}
          aria-hidden
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <Star
              key={i}
              className={cn(star, "shrink-0 fill-primary")}
              strokeWidth={1.5}
            />
          ))}
        </span>
      </span>
      <span
        className="text-xs text-muted-foreground tabular-nums"
        data-testid="star-rating-count"
      >
        {average.toFixed(1)} ({count})
      </span>
    </div>
  );
}
