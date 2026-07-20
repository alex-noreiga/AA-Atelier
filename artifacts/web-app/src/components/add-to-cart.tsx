import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, ShoppingBag } from "lucide-react";
import type { ProductVariant } from "@workspace/api-client-react";
import { useCart, type CartItem } from "@/lib/cart";
import { useToast } from "@/hooks/use-toast";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Map a buyable, priced variant to a one-size cart line (no size band). */
function toCartLine(variant: ProductVariant): Omit<CartItem, "quantity"> {
  return {
    variantId: variant.id,
    name: variant.name,
    // A priced add-on always has a number here; guard for the type only.
    price: typeof variant.price === "number" ? variant.price : 0,
    ...(variant.photos[0] ? { photo: variant.photos[0] } : {}),
    ...(typeof variant.quantityAvailable === "number"
      ? { quantityAvailable: variant.quantityAvailable }
      : {}),
  };
}

/**
 * Adds an in-stock, priced variant to the cart. For a sized item (a dress) the
 * size is chosen upstream in `SizeSelector` and passed in as `size`; the button
 * stays disabled until one is picked. A one-size item (a soaker) adds directly.
 * Unpriced items never reach here — the shop routes those to an enquiry instead
 * (see `CtaLink`).
 *
 * `addOns` are matching companion products (a soaker's blade towel) resolved by
 * the shop from the variant's `addOnIds`. Each renders an opt-in checkbox; a
 * checked add-on is dropped into the cart as its own one-size line (quantity 1)
 * alongside the main item. Removing the main item later does not remove the
 * add-on — each is an independent cart line.
 */
export function AddToCartButton({
  variant,
  size = "",
  addOns = [],
}: {
  variant: ProductVariant;
  size?: string;
  addOns?: ProductVariant[];
}) {
  const { addItem } = useCart();
  const { toast } = useToast();
  // Ids of the add-ons the customer has ticked. Empty (all off) by default.
  const [checkedAddOns, setCheckedAddOns] = useState<Set<string>>(new Set());
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

  const toggleAddOn = (id: string) => {
    setCheckedAddOns((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
    // Each ticked add-on becomes its own one-size line (always a single unit,
    // regardless of the main item's quantity).
    const addedAddOns = addOns.filter((a) => checkedAddOns.has(a.id));
    for (const addOn of addedAddOns) {
      addItem(toCartLine(addOn));
    }
    const names = [
      size ? `${variant.name} — ${size}` : variant.name,
      ...addedAddOns.map((a) => a.name),
    ];
    toast({
      title: "Added to cart",
      description: names.join(" + "),
    });
    setCheckedAddOns(new Set());
  };

  return (
    <div className="flex flex-col gap-4">
      {addOns.length > 0 && (
        <div
          className="flex flex-col gap-2"
          data-testid={`add-ons-${variant.id}`}
        >
          {addOns.map((addOn) => (
            <label
              key={addOn.id}
              className="flex cursor-pointer items-center gap-2.5 text-xs text-muted-foreground"
              data-testid={`add-on-${addOn.id}`}
            >
              <input
                type="checkbox"
                checked={checkedAddOns.has(addOn.id)}
                onChange={() => toggleAddOn(addOn.id)}
                className="h-4 w-4 shrink-0 accent-primary"
                data-testid={`add-on-checkbox-${addOn.id}`}
              />
              <span>
                Add matching{" "}
                <span className="text-foreground">{addOn.name}</span>
                {typeof addOn.price === "number" && (
                  <span className="text-primary">
                    {" "}
                    — {formatPrice(addOn.price)}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}
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
    </div>
  );
}
