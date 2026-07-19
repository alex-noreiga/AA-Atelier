import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import {
  useGetOrderStatus,
  useGetShopOrderStatus,
  getGetOrderStatusQueryKey,
  getGetShopOrderStatusQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { Seo } from "@/components/seo";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { CustomOrderResult } from "@/components/custom-order-result";
import { ShopOrderResult } from "@/components/shop-order-result";
import { Loader2, PenLine } from "lucide-react";

/**
 * Unified order tracking. A single lookup serves both custom (bespoke) orders
 * and ready-to-wear shop orders — the customer never has to know which kind
 * they have. The two order-number formats are disjoint (shop orders are issued
 * as "SHP-XXXX-XXXX"; custom orders are numeric, e.g. "000002"), so we route the
 * entered number to the right backend by prefix and render the matching result.
 *
 * Arriving with `?orderNumber=…` (from the shop success page) looks it up on
 * arrival. Replaces the old split `/shop/status` + `/shop/order-status` pages,
 * which now redirect here.
 */
type OrderKind = "custom" | "shop";

function detectKind(orderNumber: string): OrderKind {
  return orderNumber.toUpperCase().startsWith("SHP") ? "shop" : "custom";
}

export default function Track() {
  const search = useSearch();
  const prefill = new URLSearchParams(search).get("orderNumber") ?? "";

  const [inputValue, setInputValue] = useState(prefill);
  const [submittedOrderNumber, setSubmittedOrderNumber] = useState<
    string | null
  >(prefill ? prefill.trim().toUpperCase() : null);

  // If the page is reached with a prefilled order number, look it up on arrival.
  useEffect(() => {
    if (prefill) {
      setInputValue(prefill);
      setSubmittedOrderNumber(prefill.trim().toUpperCase());
    }
  }, [prefill]);

  const kind = submittedOrderNumber ? detectKind(submittedOrderNumber) : null;

  // Both hooks are always called (Rules of Hooks); only the one matching the
  // detected format is enabled, so a lookup hits a single backend.
  const custom = useGetOrderStatus(submittedOrderNumber || "", {
    query: {
      enabled: !!submittedOrderNumber && kind === "custom",
      queryKey: submittedOrderNumber
        ? getGetOrderStatusQueryKey(submittedOrderNumber)
        : ["none"],
      retry: false, // Don't retry on 404
    },
  });
  const shop = useGetShopOrderStatus(submittedOrderNumber || "", {
    query: {
      enabled: !!submittedOrderNumber && kind === "shop",
      queryKey: submittedOrderNumber
        ? getGetShopOrderStatusQueryKey(submittedOrderNumber)
        : ["none"],
      retry: false, // Don't retry on 404
    },
  });

  const active = kind === "shop" ? shop : custom;
  const isLoading = active.isLoading;
  const isError = !!active.error;

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      setSubmittedOrderNumber(inputValue.trim().toUpperCase());
    }
  };

  const handleReset = () => {
    setSubmittedOrderNumber(null);
    setInputValue("");
  };

  const errorMessage =
    (active.error as { data?: { message?: string } })?.data?.message ||
    (kind === "shop"
      ? "We couldn't find a shop order with that number. Please check and try again."
      : "We couldn't find an order with that number. Please check and try again.");

  return (
    <PageShell>
      <Seo {...ROUTE_SEO["/track"]} />
      <div className="w-full max-w-lg z-10 mx-auto animate-in fade-in zoom-in-95 duration-1000">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-4">
            Track Your Order
          </h1>
          <p className="text-muted-foreground font-light text-lg">
            Enter your order number to follow its progress.
          </p>
        </div>

        {/* State: Initial / Form */}
        {!submittedOrderNumber && (
          <form onSubmit={handleLookup} className="space-y-6">
            <div className="relative group">
              <Input
                type="text"
                placeholder="Enter your order number"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="w-full bg-transparent border-0 border-b border-border rounded-none px-4 py-6 text-center text-xl tracking-widest placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:border-primary transition-colors h-auto shadow-none"
                data-testid="input-order-number"
              />
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-[1px] bg-primary transition-all duration-500 group-focus-within:w-full"></div>
            </div>
            <p className="text-center text-xs text-muted-foreground/70 font-light tracking-wide">
              Works for both custom commissions and shop orders (SHP-…).
            </p>
            <div className="flex justify-center pt-4">
              <Button
                type="submit"
                disabled={!inputValue.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-6 rounded-full tracking-widest uppercase text-xs transition-all duration-300 hover:shadow-[0_0_24px_var(--glow-primary)] disabled:opacity-50 disabled:hover:shadow-none"
                data-testid="button-lookup"
              >
                Find Order
              </Button>
            </div>
            <div className="flex justify-center pt-2">
              <Link
                to="/order"
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors tracking-widest uppercase group"
                data-testid="link-place-order"
              >
                <PenLine className="w-4 h-4" />
                Place a new order instead
              </Link>
            </div>
          </form>
        )}

        {/* State: Loading */}
        {submittedOrderNumber && isLoading && (
          <div
            className="flex flex-col items-center justify-center py-16 space-y-6 animate-in fade-in duration-500"
            data-testid="status-loading"
          >
            <Loader2
              className="w-8 h-8 text-primary animate-spin"
              strokeWidth={1}
            />
            <p className="text-muted-foreground font-light italic font-serif text-lg">
              Finding your order...
            </p>
          </div>
        )}

        {/* State: Error */}
        {submittedOrderNumber && isError && !isLoading && (
          <div
            className="text-center space-y-8 py-8 animate-in slide-in-from-bottom-4 fade-in duration-700"
            data-testid="status-error"
          >
            <div className="w-16 h-[1px] bg-destructive/50 mx-auto"></div>
            <p className="text-destructive font-serif text-xl">
              {errorMessage}
            </p>
            <Button
              variant="outline"
              onClick={handleReset}
              className="border-primary/20 text-primary hover:bg-primary/10 rounded-full px-6"
              data-testid="button-try-again"
            >
              Try another number
            </Button>
          </div>
        )}

        {/* State: Success — custom (bespoke) order */}
        {kind === "custom" && custom.data && !isLoading && !isError && (
          <CustomOrderResult orderStatus={custom.data} onReset={handleReset} />
        )}

        {/* State: Success — ready-to-wear shop order */}
        {kind === "shop" && shop.data && !isLoading && !isError && (
          <ShopOrderResult order={shop.data} onReset={handleReset} />
        )}
      </div>
    </PageShell>
  );
}
