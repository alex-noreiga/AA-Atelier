import { Link } from "wouter";
import { useCreateOrderPayment } from "@workspace/api-client-react";
import type { OrderStatus, InvoiceDeposit } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { MeasurementChangeDialog } from "@/components/measurement-change-dialog";
import { CtaLink } from "@/components/cta";
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
        {deposit.sessionId && (
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

      <DepositsSection
        orderNumber={orderStatus.orderNumber}
        deposits={orderStatus.deposits}
      />

      {orderStatus.invoice &&
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

      <div className="relative pl-6 md:pl-8 space-y-12">
        {/* Vertical Thread Line */}
        <div className="absolute left-[11px] md:left-[15px] top-2 bottom-2 w-[1px] bg-border z-0"></div>

        {orderStatus.stages.map((stage, index) => {
          const currentIndex = orderStatus.stages.indexOf(
            orderStatus.currentStage,
          );
          const isCompleted = index < currentIndex;
          const isActive = index === currentIndex;
          const isFuture = index > currentIndex;
          // Per-stage target date from the Production Schedule, when the
          // atelier has generated milestones (matched by stage name).
          const targetDate = orderStatus.milestones?.find(
            (m) => m.stage === stage,
          )?.targetDate;

          return (
            <div
              key={stage}
              className="relative z-10 flex items-start group"
              data-testid={`row-stage-${index}`}
            >
              {/* Stage Indicator Node */}
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

              {/* Stage Content */}
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
                  {stage}
                </h3>
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
        {orderStatus.measurementsLocked ? (
          <p
            className="text-sm font-light text-muted-foreground/70 text-center max-w-sm"
            data-testid="measurements-locked"
          >
            Measurements are locked now that your garment is in production. Need
            a change? Please contact us.
          </p>
        ) : (
          <MeasurementChangeDialog orderNumber={orderStatus.orderNumber} />
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
