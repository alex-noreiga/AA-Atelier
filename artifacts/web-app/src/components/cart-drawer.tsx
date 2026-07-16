import { useState } from "react";
import { Loader2, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { useCreateCheckoutSession } from "@workspace/api-client-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useCart, lineKey } from "@/lib/cart";
import { formatPrice } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * The cart affordance rendered in the navbar: a bag icon with a live count that
 * opens a drawer listing the cart, and a Checkout button that creates a Stripe
 * Checkout session and redirects the browser to the hosted payment page.
 */
export function CartButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const { items, count, subtotal, updateQuantity, removeItem } = useCart();
  const { toast } = useToast();

  const checkout = useCreateCheckoutSession({
    mutation: {
      onSuccess: ({ url }) => {
        // Hosted redirect — no Stripe.js/publishable key needed on the client.
        window.location.href = url;
      },
      onError: (error) => {
        toast({
          variant: "destructive",
          title: "Couldn't start checkout",
          description:
            error.data?.error ||
            error.message ||
            "Something went wrong. Please try again.",
        });
      },
    },
  });

  const onCheckout = () => {
    checkout.mutate({
      data: {
        items: items.map((i) => ({
          variantId: i.variantId,
          ...(i.size ? { size: i.size } : {}),
          quantity: i.quantity,
        })),
      },
    });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className={cn(
          "relative text-foreground hover:text-primary transition-colors p-2",
          className,
        )}
        aria-label={`Cart (${count} item${count === 1 ? "" : "s"})`}
        data-testid="cart-button"
      >
        <ShoppingBag className="w-5 h-5" strokeWidth={1.5} />
        {count > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.6rem] font-medium text-primary-foreground"
            data-testid="cart-count"
          >
            {count}
          </span>
        )}
      </SheetTrigger>
      <SheetContent
        side="right"
        className="bg-background border-l border-border w-full sm:max-w-md flex flex-col"
        data-testid="cart-drawer"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="font-serif text-2xl tracking-wide">
            Your Cart
          </SheetTitle>
        </SheetHeader>

        {items.length === 0 ? (
          <p
            className="mt-8 text-muted-foreground font-light"
            data-testid="cart-empty"
          >
            Your cart is empty.
          </p>
        ) : (
          <>
            <div className="mt-6 flex-1 overflow-y-auto -mx-6 px-6 divide-y divide-border/60">
              {items.map((item) => {
                const key = lineKey(item.variantId, item.size);
                const atMax =
                  typeof item.quantityAvailable === "number" &&
                  item.quantity >= item.quantityAvailable;
                return (
                  <div
                    key={key}
                    className="flex gap-4 py-4"
                    data-testid={`cart-item-${key}`}
                  >
                    <div className="h-20 w-16 shrink-0 overflow-hidden rounded-md border border-border/60 bg-card">
                      {item.photo ? (
                        <img
                          src={item.photo}
                          alt={item.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <span className="font-serif text-primary/40">AA</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-1 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-serif text-foreground">
                            {item.name}
                          </p>
                          {item.size && (
                            <p className="text-xs uppercase tracking-widest text-muted-foreground">
                              {item.size}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItem(item.variantId, item.size)}
                          aria-label={`Remove ${item.name}`}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          data-testid={`cart-remove-${key}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="mt-auto flex items-center justify-between pt-2">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              updateQuantity(
                                item.variantId,
                                item.size,
                                item.quantity - 1,
                              )
                            }
                            aria-label="Decrease quantity"
                            className="text-muted-foreground hover:text-primary transition-colors"
                            data-testid={`cart-decrease-${key}`}
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span
                            className="w-5 text-center text-sm"
                            data-testid={`cart-qty-${key}`}
                          >
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              updateQuantity(
                                item.variantId,
                                item.size,
                                item.quantity + 1,
                              )
                            }
                            disabled={atMax}
                            aria-label="Increase quantity"
                            title={
                              atMax
                                ? `Only ${item.quantityAvailable} in stock`
                                : undefined
                            }
                            className={cn(
                              "text-muted-foreground transition-colors",
                              atMax
                                ? "opacity-40 cursor-not-allowed"
                                : "hover:text-primary",
                            )}
                            data-testid={`cart-increase-${key}`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <span className="text-primary font-light">
                          {formatPrice(item.price * item.quantity)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  Subtotal
                </span>
                <span
                  className="font-serif text-xl text-foreground"
                  data-testid="cart-subtotal"
                >
                  {formatPrice(subtotal)}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground font-light">
                Shipping calculated at checkout.
              </p>
              <button
                type="button"
                onClick={onCheckout}
                disabled={checkout.isPending}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-4 text-xs uppercase tracking-widest text-primary-foreground transition-all duration-300 hover:bg-primary/90 disabled:opacity-50"
                data-testid="cart-checkout"
              >
                {checkout.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Redirecting…
                  </>
                ) : (
                  "Checkout"
                )}
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
