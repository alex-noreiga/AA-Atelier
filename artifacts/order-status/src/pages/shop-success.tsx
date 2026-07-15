import { useEffect } from "react";
import { Link, useSearch } from "wouter";
import { ArrowRight, CheckCircle } from "lucide-react";
import {
  getGetCheckoutSessionQueryKey,
  useGetCheckoutSession,
} from "@workspace/api-client-react";
import { PageShell } from "@/components/page-shell";
import { ReceiptRow } from "@/components/receipt-row";
import { formatPrice } from "@/lib/format";
import { useCart } from "@/lib/cart";

/**
 * Post-checkout landing page. Stripe redirects here (with `?session_id=…`) only
 * after a completed payment, so we clear the cart on arrival and confirm the
 * order with an itemized receipt. The session lookup is best-effort — a
 * confirmation still shows if it fails, since the payment already went through.
 */
export default function ShopSuccess() {
  const search = useSearch();
  const sessionId = new URLSearchParams(search).get("session_id") ?? "";
  const { clear } = useCart();

  // Clear once on arrival: reaching this page means payment completed.
  useEffect(() => {
    clear();
  }, [clear]);

  const { data } = useGetCheckoutSession(sessionId, {
    query: {
      enabled: Boolean(sessionId),
      queryKey: getGetCheckoutSessionQueryKey(sessionId),
    },
  });

  const lineItems = data?.lineItems ?? [];

  return (
    <PageShell align="center">
      <div className="w-full max-w-lg z-10 mx-auto px-6 text-center animate-in fade-in zoom-in-95 duration-1000">
        <CheckCircle
          className="w-14 h-14 text-primary mx-auto mb-8"
          strokeWidth={1}
        />
        <p className="text-primary text-xs tracking-[0.35em] uppercase mb-6">
          Order confirmed
        </p>
        <h1 className="text-4xl md:text-6xl font-serif text-foreground leading-[1.05] mb-8">
          Thank you
        </h1>
        <p
          className="text-muted-foreground font-light text-lg leading-relaxed"
          data-testid="shop-success"
        >
          Your payment went through
          {data?.email ? (
            <>
              {" "}
              — a receipt is on its way to{" "}
              <span className="text-foreground">{data.email}</span>
            </>
          ) : null}
          . We&apos;ll be in touch soon.
        </p>

        {lineItems.length > 0 && (
          <div
            className="mt-10 rounded-2xl border border-border/60 p-6 text-left"
            data-testid="receipt"
          >
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-4">
              Receipt
            </p>
            <ul className="space-y-2">
              {lineItems.map((item, i) => (
                <li
                  key={i}
                  className="flex justify-between gap-4 text-sm"
                  data-testid="receipt-item"
                >
                  <span className="text-foreground">
                    {item.quantity} × {item.description}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {formatPrice(item.amount)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 space-y-1 border-t border-border/60 pt-4">
              <ReceiptRow label="Subtotal" amount={data?.amountSubtotal ?? 0} />
              {data?.amountShipping ? (
                <ReceiptRow label="Shipping" amount={data.amountShipping} />
              ) : null}
              {data?.amountTax ? (
                <ReceiptRow label="Tax" amount={data.amountTax} />
              ) : null}
              <div className="flex justify-between pt-2 font-serif text-lg text-foreground">
                <span>Total</span>
                <span data-testid="receipt-total">
                  {formatPrice(data?.amountTotal ?? 0)}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="mt-12">
          <Link
            to="/shop"
            className="group inline-flex items-center gap-2 border border-border text-foreground hover:border-primary hover:text-primary px-8 py-4 rounded-full tracking-widest uppercase text-xs transition-all duration-300"
            data-testid="back-to-shop"
          >
            Back to the shop
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
