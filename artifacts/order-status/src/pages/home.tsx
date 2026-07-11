import { useState } from "react";
import { Link } from "wouter";
import {
  useGetOrderStatus,
  getGetOrderStatusQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, PenLine } from "lucide-react";

export default function Home() {
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
    <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center p-6 relative overflow-hidden bg-background">
      {/* Subtle background noise texture */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.03] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")",
        }}
      ></div>

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
                className="bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-6 rounded-full tracking-widest uppercase text-xs transition-all duration-300 hover:shadow-[0_0_20px_rgba(209,156,151,0.2)] disabled:opacity-50 disabled:hover:shadow-none"
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
                Place an Order
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
              <h3 className="text-3xl font-serif">{orderStatus.orderName}</h3>
            </div>

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
                      <h4
                        className={`
                        font-serif text-2xl mb-1
                        ${isActive ? "text-primary" : "text-foreground"}
                      `}
                      >
                        {stage}
                      </h4>
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

            <div className="mt-16 flex justify-center">
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
    </div>
  );
}

// Helper to add flavor text based on the active stage
function getStageDescription(stage: string): string {
  const descriptions: Record<string, string> = {
    Consultation:
      "We're still discussing your vision, measurements, and stylistic desires.",
    Sketching:
      "We're translating your ideas into the preliminary designs and technical flats.",
    Sourcing:
      "We're currently curating fabrics, laces, and embellishments from our trusted suppliers.",
    "Pattern Design":
      "Drafting the precise pattern pieces that will shape your garment.",
    "Cutting/Pinning":
      "Cutting fabric to pattern and pinning the foundational silhouette.",
    "Sewing/Construction":
      "We're currently sewing and constructing the garment by hand and machine.",
    Assembly: "We're now assembling all the pieces of your final costume.",
    Fitting: "We're currently in the process of scheduling your fitting(s)!",
    "Rhinestoning/Deatiling":
      "We're now applying hand-beading, crystals, and all the artistic final touches for your costume.",
    "Ready for delivery/pickup":
      "Your garment is complete and awaiting delivery or pickup.",
    Delivery: "Your costume is now delivered!",
  };
  return (
    descriptions[stage] || "Carefully working on this stage of your garment."
  );
}
