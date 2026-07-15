import { Bell } from "lucide-react";
import type { ProductVariant } from "@workspace/api-client-react";
import { NotifyDialog } from "@/components/notify-dialog";
import { cn } from "@/lib/utils";

/** Notion size names become stable testid slugs (`Adult XS` → `adult-xs`). */
function slug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

/**
 * The size bands an item is offered in — a single control that both shows the
 * sizes and, when the variant is buyable, lets the customer pick one. It
 * replaces the old native `<select>` (inelegant on mobile) plus the separate
 * display-only chip row, so sizes appear once instead of twice.
 *
 * - In-stock size, `selectable` → a toggle pill that drives Add-to-cart.
 * - In-stock size, not `selectable` (unpriced or sold-out variant) → an inert
 *   label, since there's nothing to add.
 * - Sold-out size → a back-in-stock request naming that exact size.
 *
 * `selectable` is true only for an available, priced variant (the same items
 * `AddToCartButton` accepts); the picker and the button share `ProductCard`'s
 * lifted `size` state so the card and its quick-view dialog stay in sync.
 */
export function SizeSelector({
  variant,
  selectedSize,
  onSelectSize,
  selectable,
}: {
  variant: ProductVariant;
  selectedSize: string;
  onSelectSize: (size: string) => void;
  selectable: boolean;
}) {
  if (variant.sizes.length === 0) return null;
  return (
    <div className="mt-5">
      <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
        Sizes
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Select size">
        {variant.sizes.map((size) => {
          const testId = `size-${variant.id}-${slug(size.name)}`;

          if (!size.available) {
            return (
              <NotifyDialog
                key={size.name}
                item={variant.name}
                size={size.name}
                trigger={(open) => (
                  <button
                    type="button"
                    onClick={open}
                    title={`${size.name} is sold out — get notified when it's back`}
                    className="group inline-flex items-center gap-1.5 rounded-full border border-border/40 px-3 py-1 text-xs text-muted-foreground/60 transition-colors hover:border-primary hover:text-primary"
                    data-testid={`size-notify-${variant.id}-${slug(size.name)}`}
                  >
                    <span className="line-through">{size.name}</span>
                    <Bell className="w-3 h-3 shrink-0" />
                  </button>
                )}
              />
            );
          }

          // Non-buyable variant (unpriced or the whole variant sold out): the
          // size is informational only, so keep it as an inert label.
          if (!selectable) {
            return (
              <span
                key={size.name}
                className="rounded-full border border-border/60 px-3 py-1 text-xs text-muted-foreground"
                data-testid={testId}
              >
                {size.name}
              </span>
            );
          }

          const isSelected = selectedSize === size.name;
          return (
            <button
              key={size.name}
              type="button"
              onClick={() => onSelectSize(size.name)}
              aria-pressed={isSelected}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                isSelected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:border-primary/50",
              )}
              data-testid={testId}
            >
              {size.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
