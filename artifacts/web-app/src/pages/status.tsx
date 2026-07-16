import { useState } from "react";
import { Link } from "wouter";
import {
  useGetOrderStatus,
  useCreateOrderDeposit,
  getGetOrderStatusQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { Seo } from "@/components/seo";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { MeasurementChangeDialog } from "@/components/measurement-change-dialog";
import { CtaLink } from "@/components/cta";
import { getStageDescription } from "@/lib/stage-descriptions";
import { formatPrice, formatDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  ArrowRight,
  PenLine,
  Check,
  CreditCard,
  Receipt,
} from "lucide-react";

/**
 * The deposit call-to-action on a custom order. Shows nothing until the atelier
 * has set a deposit amount; then it invites payment, or confirms once paid.
 * Paying redirects to Stripe's hosted checkout (like the shop cart).
 */
function DepositSection({
  orderNumber,
  amount,
  paid,
  sessionId,
}: {
  orderNumber: string;
  amount?: number;
  paid?: boolean;
  sessionId?: string;
}) {
  const { toast } = useToast();
  const deposit = useCreateOrderDeposit({
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

  if (paid) {
    return (
      <div className="mb-12 flex flex-col items-center gap-4">
        <div
          className="flex items-center justify-center gap-2 text-sm tracking-widest uppercase text-primary"
          data-testid="deposit-paid"
        >
          <Check className="w-4 h-4" />
          Deposit paid
        </div>
        {sessionId && (
          <CtaLink
            to={`/shop/success?session_id=${encodeURIComponent(sessionId)}`}
            variant="outline"
            data-testid="link-deposit-receipt"
          >
            <Receipt className="w-4 h-4" />
            View receipt
          </CtaLink>
        )}
      </div>
    );
  }

  if (typeof amount !== "number" || amount <= 0) return null;

  return (
    <div
      className="mb-12 rounded-2xl border border-border/60 p-6 text-center"
      data-testid="deposit-due"
    >
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        Deposit due
      </p>
      <p className="mt-1 font-serif text-3xl text-primary">
        {formatPrice(amount)}
      </p>
      <Button
        onClick={() => deposit.mutate({ orderNumber })}
        disabled={deposit.isPending}
        className="mt-5 bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-6 rounded-full tracking-widest uppercase text-xs transition-all duration-300 disabled:opacity-50"
        data-testid="button-pay-deposit"
      >
        {deposit.isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Redirecting…
          </>
        ) : (
          <>
            <CreditCard className="w-4 h-4 mr-2" />
            Pay deposit
          </>
        )}
      </Button>
    </div>
  );
}

export default function Status() {
  const [inputValue, setInputValue] = useState("");
  const [submittedOrderNumber, setSubmittedOrderNumber] = useState<
    string | null
  >(null);

  const {
    data: orderStatus,
    isLoading,
    error,
  } = useGetOrderStatus(submittedOrderNumber || "", {
    query: {
      enabled: !!submittedOrderNumber,
      queryKey: submittedOrderNumber
        ? getGetOrderStatusQueryKey(submittedOrderNumber)
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
    (error as any)?.data?.message ||
    "We couldn't find an order with that number. Please check and try again.";

  return (
    <PageShell>
      <Seo {...ROUTE_SEO["/shop/status"]} />
      <div className="w-full max-w-lg z-10 mx-auto animate-in fade-in zoom-in-95 duration-1000">
        {/* Header Section */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-4">
            Order Status
          </h1>
          <p className="text-muted-foreground font-light text-lg">
            Check the current status of your custom order.
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

        {/* State: Success / Order Found */}
        {orderStatus && !isLoading && !isError && (
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

            <DepositSection
              orderNumber={orderStatus.orderNumber}
              amount={orderStatus.depositAmount}
              paid={orderStatus.depositPaid}
              sessionId={orderStatus.depositSessionId}
            />

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
                  Measurements are locked now that your garment is in production.
                  Need a change? Please contact us.
                </p>
              ) : (
                <MeasurementChangeDialog orderNumber={orderStatus.orderNumber} />
              )}
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
