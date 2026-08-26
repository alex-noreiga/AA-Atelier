import type { ShopOrderStatus } from "@workspace/api-client-react";
import { formatPrice } from "@/lib/format";
import { CancellationRequestDialog } from "@/components/cancellation-request-dialog";
import { ArrowRight } from "lucide-react";
import { ReturnExchangeDialog } from "@/components/return-exchange-dialog";
import { StatusTimeline } from "@/components/status-timeline";
import { FulfilmentPanel } from "@/components/fulfilment-panel";
import { ShopReviewDialog } from "@/components/shop-review-dialog";

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
  // The pieces the server could name, present only once the order has reached
  // its final status — so this is both "is it delivered?" and "is there anything
  // to review?" in one, and it is the server's own answer to both rather than a
  // second copy of the rule.
  const reviewable = order.items ?? [];

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

      {/* Carrier tracking, or the collection details when the customer is
          picking up locally. The server already omits this on a cancelled
          order; the guard keeps that true if that ever changes. */}
      {!isCancelled && <FulfilmentPanel fulfilment={order.fulfilment} />}

      <div className="mt-16 flex flex-col items-center gap-6">
        {!isCancelled && (
          <>
            {reviewable.length > 0 && (
              <ShopReviewDialog
                orderNumber={order.orderNumber}
                items={reviewable}
              />
            )}
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
