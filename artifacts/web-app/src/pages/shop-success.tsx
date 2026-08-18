import { useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { ArrowRight, CheckCircle } from "lucide-react";
import {
  getGetCheckoutSessionQueryKey,
  useGetCheckoutSession,
} from "@workspace/api-client-react";
import { PageShell } from "@/components/page-shell";
import { CtaLink } from "@/components/cta";
import { DownloadPdfButton } from "@/components/download-pdf-button";
import { Seo } from "@/components/seo";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { ReceiptRow } from "@/components/receipt-row";
import { formatPrice } from "@/lib/format";
import { useCart } from "@/lib/cart";
import { useAnalytics, AnalyticsEvent } from "@/lib/analytics";

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
  const analytics = useAnalytics();
  // Guards the purchase event to at most once per checkout session (StrictMode
  // double-invokes effects, and the session query can re-settle on refetch).
  const purchaseTracked = useRef<string | null>(null);

  const { data } = useGetCheckoutSession(sessionId, {
    query: {
      enabled: Boolean(sessionId),
      queryKey: getGetCheckoutSessionQueryKey(sessionId),
    },
  });

  // Clear the cart only for a shop-cart order — not a custom-order payment
  // receipt (deposit or balance), which reaches this same page from the status
  // page and must leave the shopper's cart untouched. Waits for the session to
  // load so `kind` is known.
  useEffect(() => {
    if (data?.kind && data.kind !== "custom_payment") {
      clear();
    }
  }, [data?.kind, clear]);

  // Conversion event: a completed payment landed here. Fired once per session,
  // and consent-gated inside useAnalytics. `kind` distinguishes a shop-cart
  // purchase from a custom-order deposit/balance; the total is Stripe's, no PII.
  useEffect(() => {
    if (!data || !sessionId || purchaseTracked.current === sessionId) return;
    purchaseTracked.current = sessionId;
    analytics(AnalyticsEvent.Purchase, {
      total: data.amountTotal ?? 0,
      kind: data.kind ?? "shop",
      ...(data.orderNumber ? { orderNumber: data.orderNumber } : {}),
    });
  }, [data, sessionId, analytics]);

  const lineItems = data?.lineItems ?? [];

  return (
    <PageShell align="center" noise={false}>
      <Seo {...ROUTE_SEO["/shop/success"]} />
      <div className="w-full max-w-lg z-10 mx-auto text-center animate-in fade-in zoom-in-95 duration-1000">
        <CheckCircle
          className="w-16 h-16 text-primary mx-auto mb-8"
          strokeWidth={1}
        />
        <p className="text-primary text-xs tracking-[0.35em] uppercase mb-8">
          Order confirmed
        </p>
        <h1 className="text-4xl md:text-5xl font-serif text-foreground leading-[1.05] mb-8">
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

        {data?.orderNumber && (
          <div
            className="mt-10 rounded-2xl border border-border/60 p-6"
            data-testid="order-number-card"
          >
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
              Your order number
            </p>
            <p
              className="font-serif text-2xl text-foreground tracking-wide"
              data-testid="order-number"
            >
              {data.orderNumber}
            </p>
            <p className="mt-3 text-sm text-muted-foreground font-light">
              Save this — you can{" "}
              <a
                href={`/track?orderNumber=${encodeURIComponent(
                  data.orderNumber,
                )}`}
                className="text-primary hover:underline"
                data-testid="track-order-link"
              >
                track your order
              </a>{" "}
              with it anytime.
            </p>
          </div>
        )}

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

        {data && lineItems.length > 0 && (
          <div className="mt-6 flex justify-center">
            <DownloadPdfButton
              onDownload={async () => {
                const { downloadReceiptPdf } =
                  await import("@/lib/pdf/receipt-pdf");
                downloadReceiptPdf(data);
              }}
            />
          </div>
        )}

        <div className="mt-12">
          <CtaLink to="/shop" variant="outline" data-testid="back-to-shop">
            Back to the shop
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </CtaLink>
        </div>
      </div>
    </PageShell>
  );
}
