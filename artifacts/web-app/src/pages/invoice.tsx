import { Link, useParams } from "wouter";
import {
  useGetOrderStatus,
  useCreateOrderPayment,
  getGetOrderStatusQueryKey,
} from "@workspace/api-client-react";
import type { Invoice, InvoiceDeposit } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { DownloadPdfButton } from "@/components/download-pdf-button";
import { PageShell } from "@/components/page-shell";
import { ReceiptRow } from "@/components/receipt-row";
import { Seo } from "@/components/seo";
import { formatPrice, formatDate } from "@/lib/format";
import { groupLineItems } from "@/lib/invoice-format";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, Check, CreditCard } from "lucide-react";

function InvoiceBreakdown({
  orderNumber,
  orderName,
  invoice,
  deposits,
}: {
  orderNumber: string;
  orderName: string;
  invoice: Invoice;
  deposits: InvoiceDeposit[];
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
          title: "Couldn't start the payment",
          description:
            detail ||
            error.message ||
            "Something went wrong. Please try again.",
        });
      },
    },
  });

  const groups = groupLineItems(invoice.lineItems);
  const canPay = !invoice.paid && invoice.balanceDue > 0;

  return (
    <div className="w-full max-w-lg mx-auto px-6">
      <div className="text-center mb-12">
        {/* The studio's own invoice number once the invoice has been ISSUED —
            from that point the charges below are a frozen snapshot of what was
            shown, not a live read. An invoice predating issuing falls back to
            the atelier's Notion title, exactly as it always read. */}
        <p className="text-primary text-sm tracking-[0.15em] uppercase mb-2">
          Invoice {invoice.invoiceNumber || invoice.invoiceId || orderNumber}
        </p>
        <h1 className="text-3xl font-serif">{orderName}</h1>
        {invoice.issuedAt ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Issued {formatDate(invoice.issuedAt)}
          </p>
        ) : null}
        {invoice.paymentDeadline ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Due {invoice.paymentDeadline}
          </p>
        ) : null}
      </div>

      <div
        className="rounded-2xl border border-border/60 p-6 text-left"
        data-testid="invoice"
      >
        {groups.map((group) => (
          <div key={group.type} className="mb-5 last:mb-0">
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
              {group.heading}
            </p>
            <ul className="space-y-2">
              {group.items.map((item, i) => (
                <li
                  key={i}
                  className="flex justify-between gap-4 text-sm"
                  data-testid="invoice-item"
                >
                  <span className="text-foreground">{item.name}</span>
                  <span className="text-muted-foreground shrink-0">
                    {formatPrice(item.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="mt-4 space-y-1 border-t border-border/60 pt-4">
          <ReceiptRow label="Subtotal" amount={invoice.subtotal} />
          {/* Credit notes: the way an issued invoice changes, since the document
              itself is never rewritten. Each carries its own number and the
              atelier's reason, because a line taken off an invoice with no
              explanation is the sort of thing that prompts a phone call. */}
          {(invoice.credits ?? []).map((credit) => (
            <div
              key={credit.creditNumber}
              className="flex justify-between gap-4 text-sm text-muted-foreground"
              data-testid="invoice-credit"
            >
              <span>
                {credit.creditNumber} · {credit.reason}
              </span>
              <span className="shrink-0">−{formatPrice(credit.amount)}</span>
            </div>
          ))}
          {deposits.map((deposit, i) => (
            <div
              key={i}
              className="flex justify-between text-sm text-muted-foreground"
              data-testid="invoice-deposit"
            >
              <span>
                {deposit.label}
                {deposit.paid ? "" : " (unpaid)"}
              </span>
              <span>
                {deposit.paid
                  ? `−${formatPrice(deposit.amount)}`
                  : formatPrice(0)}
              </span>
            </div>
          ))}
          <div className="flex justify-between pt-2 font-serif text-lg text-foreground">
            <span>Balance due</span>
            <span data-testid="invoice-balance">
              {formatPrice(invoice.balanceDue)}
            </span>
          </div>
        </div>
      </div>

      {invoice.paid ? (
        <div
          className="mt-8 flex items-center justify-center gap-2 text-sm tracking-widest uppercase text-primary"
          data-testid="invoice-paid"
        >
          <Check className="w-4 h-4" />
          Balance paid
        </div>
      ) : canPay ? (
        <div className="mt-8 text-center">
          <Button
            onClick={() => payment.mutate({ orderNumber, stage: "balance" })}
            disabled={payment.isPending}
            className="bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-6 rounded-full tracking-widest uppercase text-xs transition-all duration-300 disabled:opacity-50"
            data-testid="button-pay-balance"
          >
            {payment.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Redirecting…
              </>
            ) : (
              <>
                <CreditCard className="w-4 h-4 mr-2" />
                Pay balance
              </>
            )}
          </Button>
        </div>
      ) : null}

      <div className="mt-8 text-center">
        <DownloadPdfButton
          onDownload={async () => {
            const { downloadInvoicePdf } =
              await import("@/lib/pdf/invoice-pdf");
            downloadInvoicePdf({ orderNumber, orderName, invoice, deposits });
          }}
        />
      </div>

      <div className="mt-12 text-center">
        <Link
          href="/track"
          className="group inline-flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors text-sm tracking-widest uppercase"
          data-testid="link-back-to-status"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back to order status
        </Link>
      </div>
    </div>
  );
}

/**
 * A custom order's invoice, reached from the status page's "View Invoice" button.
 * Reads the invoice off the order status (it rides on the same payload) and lets
 * the customer pay the outstanding balance. Shows nothing to pay until the
 * atelier has flipped "Invoice Ready" (then `orderStatus.invoice` is present).
 */
export default function InvoicePage() {
  const params = useParams();
  const orderNumber = (params.orderNumber ?? "").toUpperCase();

  const {
    data: orderStatus,
    isLoading,
    isError,
  } = useGetOrderStatus(orderNumber, {
    query: {
      enabled: !!orderNumber,
      queryKey: getGetOrderStatusQueryKey(orderNumber),
      retry: false,
    },
  });

  return (
    <PageShell align="center">
      <Seo
        title="Invoice | A.A Atelier"
        description="Your custom order invoice and outstanding balance."
        path={`/invoice/${orderNumber}`}
        noindex
      />
      {isLoading ? (
        <div
          className="flex items-center justify-center py-24"
          data-testid="invoice-loading"
        >
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : isError || !orderStatus ? (
        <div className="text-center px-6" data-testid="invoice-error">
          <h1 className="text-3xl font-serif mb-4">Order not found</h1>
          <p className="text-muted-foreground">
            We couldn&apos;t find an order with that number.
          </p>
          <Link
            href="/track"
            className="mt-8 inline-flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors text-sm tracking-widest uppercase"
            data-testid="link-back-to-status"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to order status
          </Link>
        </div>
      ) : !orderStatus.invoice ? (
        <div className="text-center px-6" data-testid="invoice-not-ready">
          <h1 className="text-3xl font-serif mb-4">Invoice not ready</h1>
          <p className="text-muted-foreground">
            Your invoice isn&apos;t ready yet. We&apos;ll let you know when it
            is.
          </p>
          <Link
            href="/track"
            className="mt-8 inline-flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors text-sm tracking-widest uppercase"
            data-testid="link-back-to-status"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to order status
          </Link>
        </div>
      ) : (
        <InvoiceBreakdown
          orderNumber={orderStatus.orderNumber}
          orderName={orderStatus.orderName}
          invoice={orderStatus.invoice}
          deposits={orderStatus.deposits ?? []}
        />
      )}
    </PageShell>
  );
}
