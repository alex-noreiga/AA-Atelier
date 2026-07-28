import type { ShopOrderStatus } from "@workspace/api-client-react";
import { formatPrice } from "@/lib/format";
import { ArrowRight } from "lucide-react";

/**
 * The "order found" body for a ready-to-wear shop order: header plus the
 * fulfilment-status timeline. A stripped sibling of {@link CustomOrderResult}
 * with no deposit, invoice, or measurement-change controls. Rendered by the
 * unified `/track` page once an `SHP-…` order number resolves.
 */
export function ShopOrderResult({
  order,
  onReset,
}: {
  order: ShopOrderStatus;
  onReset: () => void;
}) {
  return (
    <div
      className="animate-in slide-in-from-bottom-8 fade-in duration-1000"
      data-testid="status-success"
    >
      <div className="text-center mb-16">
        <p className="text-primary text-sm tracking-[0.15em] uppercase mb-2">
          Order {order.orderNumber}
        </p>
        {typeof order.total === "number" && (
          <h2 className="text-3xl font-serif">{formatPrice(order.total)}</h2>
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
          onClick={onReset}
          className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-2 text-sm tracking-widest uppercase group"
          data-testid="button-check-another"
        >
          <span>Check another order</span>
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
    </div>
  );
}
