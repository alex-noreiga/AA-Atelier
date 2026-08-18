import { Link } from "wouter";
import { useCreateOrderPayment } from "@workspace/api-client-react";
import type { OrderStatus, InvoiceDeposit } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { MeasurementChangeDialog } from "@/components/measurement-change-dialog";
import { CancellationRequestDialog } from "@/components/cancellation-request-dialog";
import { ReviewDialog } from "@/components/review-dialog";
import { CtaLink } from "@/components/cta";
import { StatusTimeline } from "@/components/status-timeline";
import { getStageDescription } from "@/lib/stage-descriptions";
import { formatPrice, formatDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  ArrowRight,
  Check,
  CreditCard,
  Receipt,
  FileText,
} from "lucide-react";

/**
 * One staged deposit call-to-action on a custom order (first or second). Invites
 * payment, or confirms once paid (with a receipt link). Paying redirects to
 * Stripe's hosted checkout (like the shop cart). Sourced from the invoice.
 */
function DepositCard({
  orderNumber,
  deposit,
}: {
  orderNumber: string;
  deposit: InvoiceDeposit;
}) {
  const { toast } = useToast();
  const payment = useCreateOrderPayment({
    mutation: {
      onSuccess: ({ url }) => {
        window.location.href = url;
      },
      onError: (error) => {
        const data = error.data;
        const detail =
          data && "error" in data
            ? data.error
            : data && "message" in data
              ? data.message
              : undefined;
        toast({
          variant: "destructive",
          title: "Couldn't start the deposit payment",
          description:
            detail ||
            error.message ||
            "Something went wrong. Please try again.",
        });
      },
    },
  });

  if (deposit.paid) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div
          className="flex items-center justify-center gap-2 text-sm tracking-widest uppercase text-primary"
          data-testid={`deposit-paid-${deposit.stage}`}
        >
          <Check className="w-4 h-4" />
          {deposit.label} paid
        </div>
        {/* Only a Stripe-processed payment has an online receipt. A deposit the
            atelier marked paid in person carries a non-Stripe marker in the
            invoice's Session Id field (e.g. "IN_PERSON"), which would 404 the
            receipt lookup — so gate on a real Stripe session id (`cs_…`). */}
        {deposit.sessionId?.startsWith("cs_") && (
          <CtaLink
            to={`/shop/success?session_id=${encodeURIComponent(deposit.sessionId)}`}
            variant="outline"
            data-testid={`link-deposit-receipt-${deposit.stage}`}
          >
            <Receipt className="w-4 h-4" />
            View receipt
          </CtaLink>
        )}
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border border-border/60 p-6 text-center"
      data-testid={`deposit-due-${deposit.stage}`}
    >
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        {deposit.label} due
      </p>
      <p className="mt-1 font-serif text-3xl text-primary">
        {formatPrice(deposit.amount)}
      </p>
      <Button
        onClick={() => payment.mutate({ orderNumber, stage: deposit.stage })}
        disabled={payment.isPending}
        className="mt-5 bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-6 rounded-full tracking-widest uppercase text-xs transition-all duration-300 disabled:opacity-50"
        data-testid={`button-pay-${deposit.stage}`}
      >
        {payment.isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Redirecting…
          </>
        ) : (
          <>
            <CreditCard className="w-4 h-4 mr-2" />
            Pay {deposit.label.toLowerCase()}
          </>
        )}
      </Button>
    </div>
  );
}

/**
 * The custom order's staged deposits (first, then second), each payable online
 * from the invoice. Renders nothing until the atelier sets a deposit amount.
 */
function DepositsSection({
  orderNumber,
  deposits,
}: {
  orderNumber: string;
  deposits?: InvoiceDeposit[];
}) {
  if (!deposits || deposits.length === 0) return null;
  return (
    <div className="mb-12 space-y-6" data-testid="deposits">
      {deposits.map((deposit) => (
        <DepositCard
          key={deposit.stage}
          orderNumber={orderNumber}
          deposit={deposit}
        />
      ))}
    </div>
  );
}

/**
 * The "order found" body for a custom (bespoke) order: header, staged deposits,
 * an invoice callout, the stage timeline (with per-stage target dates and the
 * active stage's description), and the measurement-change affordance. Rendered
 * by the unified `/track` page once a numeric order number resolves.
 */
export function CustomOrderResult({
  orderStatus,
  onReset,
}: {
  orderStatus: OrderStatus;
  onReset: () => void;
}) {
  // "Delivered" is the final stage in the live list — the moment we invite a
  // review. Derived positionally (no baked-in stage name) so it survives the
  // atelier renaming stages, mirroring the server's own delivery gate.
  const isDelivered =
    orderStatus.stages.length > 0 &&
    orderStatus.currentStage ===
      orderStatus.stages[orderStatus.stages.length - 1];

  // Once the atelier has cancelled the order, suppress the payment / invoice /
  // review / measurement + cancellation affordances and show a cancelled banner.
  const isCancelled = orderStatus.cancelled === true;

  return (
    <div
      className="animate-in slide-in-from-bottom-8 fade-in duration-1000"
      data-testid="status-success"
    >
      <div className="text-center mb-16">
        <p className="text-primary text-sm tracking-[0.15em] uppercase mb-2">
          Order {orderStatus.orderNumber}
        </p>
        <h2 className="text-3xl font-serif">{orderStatus.orderName}</h2>
        {orderStatus.estimatedCompletion && (
          <p
            className="mt-4 text-sm font-light text-muted-foreground"
            data-testid="estimated-completion"
          >
            <span className="tracking-[0.15em] uppercase text-xs">
              Estimated completion
            </span>
            <span className="mx-2 text-border">·</span>
            {formatDate(orderStatus.estimatedCompletion)}
          </p>
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

      {!isCancelled && (
        <DepositsSection
          orderNumber={orderStatus.orderNumber}
          deposits={orderStatus.deposits}
        />
      )}

      {!isCancelled &&
        orderStatus.invoice &&
        (orderStatus.invoice.paid || orderStatus.invoice.balanceDue > 0) && (
          <div
            className="mb-12 rounded-2xl border border-border/60 p-6 text-center"
            data-testid="invoice-callout"
          >
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {orderStatus.invoice.paid ? "Invoice" : "Balance due"}
            </p>
            <p className="mt-1 font-serif text-3xl text-primary">
              {orderStatus.invoice.paid
                ? "Paid in full"
                : formatPrice(orderStatus.invoice.balanceDue)}
            </p>
            <Link
              href={`/invoice/${orderStatus.orderNumber}`}
              className="mt-5 inline-flex items-center gap-2 border border-border text-foreground hover:border-primary hover:text-primary px-8 py-4 rounded-full tracking-widest uppercase text-xs transition-all duration-300"
              data-testid="link-view-invoice"
            >
              <FileText className="w-4 h-4" />
              View invoice
            </Link>
          </div>
        )}

      {!isCancelled && isDelivered && (
        <div
          className="mb-12 rounded-2xl border border-border/60 p-6 text-center"
          data-testid="review-invite"
        >
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Your piece is finished
          </p>
          <p className="mt-1 font-serif text-2xl">
            We'd love to hear how it turned out
          </p>
          <div className="mt-5 flex justify-center">
            <ReviewDialog orderNumber={orderStatus.orderNumber} />
          </div>
        </div>
      )}

      <StatusTimeline
        items={orderStatus.stages}
        currentIndex={orderStatus.stages.indexOf(orderStatus.currentStage)}
        testIdPrefix="row-stage"
        renderExtra={(stage, index, { isActive }) => {
          // Per-stage target date from the Production Schedule, when the
          // atelier has generated milestones (matched by stage name).
          const targetDate = orderStatus.milestones?.find(
            (m) => m.stage === stage,
          )?.targetDate;
          return (
            <>
              {targetDate && (
                <p
                  className="text-muted-foreground/70 font-light text-xs uppercase tracking-widest mb-1"
                  data-testid={`stage-target-${index}`}
                >
                  Target · {formatDate(targetDate)}
                </p>
              )}
              {isActive && (
                <p className="text-muted-foreground font-light text-sm animate-in fade-in slide-in-from-left-2 duration-700 delay-300 fill-mode-both">
                  {getStageDescription(stage)}
                </p>
              )}
            </>
          );
        }}
      />

      <div className="mt-16 flex flex-col items-center gap-6">
        {/* A delivered order shows the review invite above; here it needs no
            measurement affordance. Otherwise: the change dialog until the
            garment is in production, then a locked notice. A cancelled order
            shows neither. */}
        {!isCancelled &&
          !isDelivered &&
          (orderStatus.measurementsLocked ? (
            <p
              className="text-sm font-light text-muted-foreground/70 text-center max-w-sm"
              data-testid="measurements-locked"
            >
              Measurements are locked now that your garment is in production.
              Need a change? Please contact us.
            </p>
          ) : (
            <MeasurementChangeDialog orderNumber={orderStatus.orderNumber} />
          ))}
        {/* Cancellation can be requested up until delivery (the server rejects a
            delivered order as a return); a cancelled order shows nothing. */}
        {!isCancelled && !isDelivered && (
          <CancellationRequestDialog
            orderNumber={orderStatus.orderNumber}
            variant="custom"
          />
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
