import { Star } from "lucide-react";

/**
 * The five-star picker shared by the two review dialogs (a finished custom
 * order, and a ready-to-wear piece from a shop order).
 *
 * Buttons rather than a native control because the shadcn set carries no radio
 * group, and a rating is a one-tap thing on a phone. It is uncontrolled from
 * react-hook-form's point of view — the caller drives it through `setValue`,
 * which is why the value comes in as a prop rather than being registered.
 */
export function StarRatingInput({
  value,
  onChange,
  idPrefix,
}: {
  value: number;
  onChange: (rating: number) => void;
  /** Prefix for each star's `data-testid`, so two dialogs on one page (or one
   * dialog and its trigger) never collide. */
  idPrefix: string;
}) {
  return (
    <div
      className="mt-2 flex items-center gap-1"
      role="radiogroup"
      aria-label="Star rating"
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          aria-label={`${star} star${star === 1 ? "" : "s"}`}
          aria-pressed={value >= star}
          data-testid={`${idPrefix}-${star}`}
          className="p-1 text-muted-foreground/40 hover:text-primary transition-colors"
        >
          <Star
            className={`w-7 h-7 transition-colors ${
              value >= star ? "fill-primary text-primary" : "fill-transparent"
            }`}
            strokeWidth={1.5}
          />
        </button>
      ))}
    </div>
  );
}
