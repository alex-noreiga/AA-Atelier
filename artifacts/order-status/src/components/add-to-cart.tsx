import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, ShoppingBag } from "lucide-react";
import type { ProductVariant } from "@workspace/api-client-react";
import { useCart } from "@/lib/cart";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * Adds an in-stock, priced variant to the cart. A sized item (a dress) shows a
 * size picker limited to in-stock bands and stays disabled until one is chosen;
 * a one-size item (a soaker) adds directly. Unpriced items never reach here —
 * the shop routes those to an enquiry instead (see `CtaLink`).
 */
export function AddToCartButton({ variant }: { variant: ProductVariant }) {
  const { addItem } = useCart();
  const { toast } = useToast();
  const availableSizes = variant.sizes.filter((s) => s.available);
  const isSized = variant.sizes.length > 0;
  const [size, setSize] = useState<string>("");

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
    });
    toast({
      title: "Added to cart",
      description: size ? `${variant.name} — ${size}` : variant.name,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {isSized && (
        <select
          value={size}
          onChange={(e) => setSize(e.target.value)}
          data-testid={`size-select-${variant.id}`}
          aria-label="Select size"
          className="rounded-full border border-border bg-transparent px-4 py-3 text-xs uppercase tracking-widest text-foreground focus-visible:border-primary focus-visible:outline-none"
        >
          <option value="">Select size</option>
          {availableSizes.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className={cn(
          "group inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-xs uppercase tracking-widest text-primary-foreground transition-all duration-300 hover:bg-primary/90 hover:shadow-[0_0_24px_rgba(209,156,151,0.25)]",
          disabled && "opacity-50 cursor-not-allowed hover:shadow-none",
        )}
        data-testid={`add-to-cart-${variant.id}`}
      >
        <ShoppingBag className="w-3.5 h-3.5" />
        Add to cart
      </button>
    </div>
  );
}
