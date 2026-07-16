import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import {
  useGetShopOrderStatus,
  getGetShopOrderStatusQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { Seo } from "@/components/seo";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { formatPrice } from "@/lib/format";
import { Loader2, ArrowRight, ShoppingBag } from "lucide-react";

/**
 * Track a ready-to-wear shop order by its order number (issued at checkout,
 * shown on the success page). A stripped sibling of the custom-order status
 * page: it reports the Notion fulfilment "Status" workflow as a timeline, with
 * no deposit or measurement-change controls. Arriving with `?orderNumber=…`
 * (from the success page) looks the order up straight away.
 */
export default function ShopOrderStatus() {
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

  const {
    data: order,
    isLoading,
    error,
  } = useGetShopOrderStatus(submittedOrderNumber || "", {
    query: {
      enabled: !!submittedOrderNumber,
      queryKey: submittedOrderNumber
        ? getGetShopOrderStatusQueryKey(submittedOrderNumber)
        : ["none"],
      retry: false, // Don't retry on 404
    },
  });

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

  const isError = !!error;
  const errorMessage =
    (error as { data?: { message?: string } })?.data?.message ||
    "We couldn't find a shop order with that number. Please check and try again.";

  return (
    <PageShell>
      <Seo {...ROUTE_SEO["/shop/order-status"]} />
      <div className="w-full max-w-lg z-10 mx-auto animate-in fade-in zoom-in-95 duration-1000">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-4">
            Track Your Order
          </h1>
          <p className="text-muted-foreground font-light text-lg">
            Enter your shop order number to see its progress.
          </p>
        </div>

        {/* State: Initial / Form */}
        {!submittedOrderNumber && (
          <form onSubmit={handleLookup} className="space-y-6">
            <div className="relative group">
              <Input
                type="text"
                placeholder="e.g. SHP-XXXX-XXXX"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="w-full bg-transparent border-0 border-b border-border rounded-none px-4 py-6 text-center text-xl tracking-widest placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:border-primary transition-colors h-auto shadow-none"
                data-testid="input-order-number"
              />
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-[1px] bg-primary transition-all duration-500 group-focus-within:w-full"></div>
            </div>
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
                to="/shop"
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors tracking-widest uppercase group"
                data-testid="link-shop"
              >
                <ShoppingBag className="w-4 h-4" />
                Back to the shop
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
            <p className="text-destructive font-serif text-xl">{errorMessage}</p>
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

        {/* State: Success / Order Found */}
        {order && !isLoading && !isError && (
          <div
            className="animate-in slide-in-from-bottom-8 fade-in duration-1000"
            data-testid="status-success"
          >
            <div className="text-center mb-16">
              <p className="text-primary text-sm tracking-[0.15em] uppercase mb-2">
                Order {order.orderNumber}
              </p>
              {typeof order.total === "number" && (
                <h2 className="text-3xl font-serif">
                  {formatPrice(order.total)}
                </h2>
              )}
            </div>

            <div className="relative pl-6 md:pl-8 space-y-12">
              {/* Vertical Thread Line */}
              <div className="absolute left-[11px] md:left-[15px] top-2 bottom-2 w-[1px] bg-border z-0"></div>

              {order.statuses.map((status, index) => {
                const currentIndex = order.statuses.indexOf(order.status);
                const isCompleted = index < currentIndex;
                const isActive = index === currentIndex;
                const isFuture = index > currentIndex;

                return (
                  <div
                    key={status}
                    className="relative z-10 flex items-start group"
                    data-testid={`row-status-${index}`}
                  >
                    {/* Status Indicator Node */}
                    <div className="absolute -left-6 md:-left-8 flex items-center justify-center w-6 h-6 bg-background">
                      <div
                        className={`
                        w-2.5 h-2.5 rounded-full transition-all duration-700
                        ${isActive ? "bg-primary shadow-[0_0_12px_var(--color-primary)] scale-125" : ""}
                        ${isCompleted ? "bg-primary/50" : ""}
                        ${isFuture ? "bg-border" : ""}
                      `}
                      />
                    </div>

                    {/* Status Content */}
                    <div
                      className={`
                      flex-1 pl-6 transition-all duration-500
                      ${isActive ? "opacity-100 translate-x-2" : ""}
                      ${isCompleted ? "opacity-60" : ""}
                      ${isFuture ? "opacity-30" : ""}
                    `}
                    >
                      <h3
                        className={`
                        font-serif text-2xl mb-1
                        ${isActive ? "text-primary" : "text-foreground"}
                      `}
                      >
                        {status}
                      </h3>
                      {isCompleted && (
                        <p className="text-muted-foreground/50 font-light text-xs uppercase tracking-widest">
                          Completed
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-16 flex flex-col items-center gap-6">
              <button
                onClick={handleReset}
                className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-2 text-sm tracking-widest uppercase group"
                data-testid="button-check-another"
              >
                <span>Check another order</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
