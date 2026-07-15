import { Link } from "wouter";
import { ArrowRight, ShoppingBag } from "lucide-react";
import type { ProductVariant } from "@workspace/api-client-react";
import { useCart } from "@/lib/cart";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * Adds an in-stock, priced variant to the cart. For a sized item (a dress) the
 * size is chosen upstream in `SizeSelector` and passed in as `size`; the button
 * stays disabled until one is picked. A one-size item (a soaker) adds directly.
 * Unpriced items never reach here — the shop routes those to an enquiry instead
 * (see `CtaLink`).
 */
export function AddToCartButton({
  variant,
  size = "",
}: {
  variant: ProductVariant;
  size?: string;
}) {
  const { addItem } = useCart();
  const { toast } = useToast();
  const availableSizes = variant.sizes.filter((s) => s.available);
  const isSized = variant.sizes.length > 0;

  // A sized item with nothing in stock can't be bought — fall back to enquiry.
  if (isSized && availableSizes.length === 0) {
    return (
      <Link
        to={`/contact?item=${encodeURIComponent(variant.name)}`}
        className="group inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-xs uppercase tracking-widest text-foreground transition-all duration-300 hover:border-primary hover:text-primary"
        data-testid={`cta-inquire-${variant.id}`}
      >
        inquire
        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
      </Link>
    );
  }

  const disabled = isSized && !size;

  const onAdd = () => {
    if (typeof variant.price !== "number" || disabled) return;
    addItem({
      variantId: variant.id,
      name: variant.name,
      ...(size ? { size } : {}),
      price: variant.price,
      ...(variant.photos[0] ? { photo: variant.photos[0] } : {}),
      ...(typeof variant.quantityAvailable === "number"
        ? { quantityAvailable: variant.quantityAvailable }
        : {}),
    });
    toast({
      title: "Added to cart",
      description: size ? `${variant.name} — ${size}` : variant.name,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className={cn(
          "group inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-xs uppercase tracking-widest text-primary-foreground transition-all duration-300 hover:bg-primary/90 hover:shadow-[0_0_24px_var(--glow-primary)]",
          disabled && "opacity-50 cursor-not-allowed hover:shadow-none",
        )}
        data-testid={`add-to-cart-${variant.id}`}
      >
        <ShoppingBag className="w-3.5 h-3.5" />
        Add to cart
      </button>
      {disabled && (
        <span className="text-xs uppercase tracking-widest text-muted-foreground/70">
          Select a size
        </span>
      )}
    </div>
  );
}
