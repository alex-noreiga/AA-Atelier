import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

const STARS = [1, 2, 3, 4, 5] as const;

/** Read-only star row for displaying a review's rating. */
export function StarRatingDisplay({
  value,
  className,
  size = 16,
}: {
  value: number;
  className?: string;
  size?: number;
}) {
  return (
    <div
      className={cn("inline-flex items-center gap-0.5", className)}
      role="img"
      aria-label={`Rated ${value} out of 5`}
      data-testid="star-display"
    >
      {STARS.map((star) => (
        <Star
          key={star}
          style={{ width: size, height: size }}
          strokeWidth={1.5}
          aria-hidden="true"
          className={
            star <= value
              ? "fill-primary text-primary"
              : "text-muted-foreground/30"
          }
        />
      ))}
    </div>
  );
}

/** Interactive, keyboard-accessible star picker for the review form. */
export function StarRatingInput({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  const [hover, setHover] = useState(0);
  const active = hover || value;

  return (
    <div
      className={cn("inline-flex items-center gap-1", className)}
      role="radiogroup"
      aria-label="Rating"
      onMouseLeave={() => setHover(0)}
    >
      {STARS.map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star > 1 ? "s" : ""}`}
          onClick={() => onChange(star)}
          onMouseEnter={() => setHover(star)}
          onFocus={() => setHover(star)}
          className="rounded p-0.5 transition-transform hover:scale-110 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
          data-testid={`star-input-${star}`}
        >
          <Star
            strokeWidth={1.5}
            className={cn(
              "h-7 w-7 transition-colors",
              star <= active
                ? "fill-primary text-primary"
                : "text-muted-foreground/40",
            )}
          />
        </button>
      ))}
    </div>
  );
}
