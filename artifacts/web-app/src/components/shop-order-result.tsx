import type { ShopOrderStatus } from "@workspace/api-client-react";
import { formatPrice } from "@/lib/format";
import { CancellationRequestDialog } from "@/components/cancellation-request-dialog";
import { ArrowRight } from "lucide-react";
import { ReturnExchangeDialog } from "@/components/return-exchange-dialog";
import { StatusTimeline } from "@/components/status-timeline";

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
  const isCancelled = order.cancelled === true;

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

      {isCancelled && (
        <div
          className="mb-12 rounded-2xl border border-border/60 p-6 text-center"
          data-testid="cancelled-banner"
        >
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            This order has been cancelled
          </p>
          <p className="mt-1 font-serif text-2xl">
            Any refund has been processed to your original payment method
          </p>
        </div>
      )}

      <StatusTimeline
        items={order.statuses}
        currentIndex={order.statuses.indexOf(order.status)}
        testIdPrefix="row-status"
      />

      <div className="mt-16 flex flex-col items-center gap-6">
        {!isCancelled && (
          <>
            <CancellationRequestDialog
              orderNumber={order.orderNumber}
              variant="shop"
            />
            <ReturnExchangeDialog orderNumber={order.orderNumber} />
          </>
        )}
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
