// The studio dashboard's shipping-label desk: type an order number, say what
// it's going in and what it weighs, read the rates, buy one.
//
// The three carrier-tracking columns on a shop order were the last thing about
// an order still copied by hand — from a second website, into a third. Buying
// the label here fills them in, and everything downstream already reads them, so
// the customer's tracking panel fills itself with no other change.
//
// The panel's whole job is to be honest about what pressing a button will do,
// because the second press spends money that cannot be un-spent:
//
//  1. **Rates first, always.** There is no "buy the cheapest" shortcut. The
//     difference between the top and bottom of a rate list is routinely three
//     days and eleven dollars, and only the atelier knows whether the dress is
//     needed on Saturday.
//  2. **The address is shown before it is paid for.** It comes from the order's
//     Stripe checkout, and it is rendered as envelope lines so a wrong one is
//     caught by eye rather than at the far end of a week.
//  3. **A test-mode label is called a test-mode label**, loudly and every time.
//     It has a tracking number, a PDF and a price, and no carrier has ever heard
//     of it — this is the one failure that looks exactly like success.
//  4. **A bought label whose write failed is not reported as a failure.** The
//     money is spent and the label is real; what's missing is a Notion row. So
//     the number is shown big enough to copy, with what to do about it.

import { useState } from "react";
import {
  useGetShippingOptions,
  useGetShippingRates,
  useBuyShippingLabel,
  getGetShippingOptionsQueryKey,
  type ParcelPreset,
  type PurchasedLabel,
  type ShippingRate,
  type ShippingRates,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { serverErrorMessage } from "@/lib/api-error";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Package,
  Truck,
} from "lucide-react";

/** Money, in whatever the carrier quoted. */
function price(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(amount);
  } catch {
    // An unexpected currency code shouldn't cost the atelier the number.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** The carrier's delivery estimate, in as few words as it gave us. */
function speed(rate: ShippingRate): string | null {
  if (rate.estimatedDays) {
    return `${rate.estimatedDays} ${rate.estimatedDays === 1 ? "day" : "days"}`;
  }
  return rate.durationTerms ?? null;
}

export function StudioShipping() {
  const options = useGetShippingOptions({
    query: { queryKey: getGetShippingOptionsQueryKey(), retry: false },
  });

  const [orderNumber, setOrderNumber] = useState("");
  const [parcelId, setParcelId] = useState("");
  const [weight, setWeight] = useState("");
  const [quote, setQuote] = useState<ShippingRates | null>(null);
  const [label, setLabel] = useState<PurchasedLabel | null>(null);
  const [replace, setReplace] = useState(false);
  const [confirming, setConfirming] = useState<ShippingRate | null>(null);

  const rates = useGetShippingRates();
  const purchase = useBuyShippingLabel();

  const parcels = options.data?.parcels ?? [];
  const chosenParcel =
    parcels.find((parcel) => parcel.id === parcelId) ?? parcels[0];
  // A vendor that isn't connected, or an address that can't be posted from,
  // are the two states only a human can clear — so the panel says which, and
  // doesn't offer a form that could only fail.
  const blocked = (options.data?.problems.length ?? 0) > 0;

  /** Anything typed invalidates the quote below it: rates are for the parcel
   * that was described, and a stale list under a changed weight is a rate the
   * atelier would buy believing it covered the new one. */
  const reset = () => {
    setQuote(null);
    setLabel(null);
    setConfirming(null);
    rates.reset();
    purchase.reset();
  };

  const onQuote = () => {
    reset();
    rates.mutate(
      {
        data: {
          orderNumber: orderNumber.trim(),
          parcelId: chosenParcel?.id ?? "",
          weightOz: Number(weight),
        },
      },
      { onSuccess: (result) => setQuote(result) },
    );
  };

  const onBuy = (rate: ShippingRate) => {
    setConfirming(null);
    purchase.mutate(
      {
        data: {
          orderNumber: quote?.orderNumber ?? orderNumber.trim(),
          rateId: rate.id,
          ...(replace ? { replace: true } : {}),
        },
      },
      {
        onSuccess: (result) => {
          setLabel(result);
          // The quote is spent — its rate ids are now bought or stale, and
          // leaving the list up invites a second label for the same parcel.
          setQuote(null);
        },
      },
    );
  };

  const canQuote =
    !blocked &&
    orderNumber.trim().length > 0 &&
    Number(weight) > 0 &&
    Boolean(chosenParcel) &&
    !rates.isPending;

  return (
    <section data-testid="panel-shipping">
      <h2 className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
        <Truck className="w-4 h-4" strokeWidth={1.5} />
        Shipping labels
      </h2>

      {options.isLoading ? (
        <div
          className="py-8 flex justify-center"
          data-testid="shipping-loading"
        >
          <Loader2
            className="w-5 h-5 animate-spin text-primary"
            strokeWidth={1}
          />
        </div>
      ) : options.isError || !options.data ? (
        <p
          className="text-sm text-muted-foreground font-light"
          data-testid="shipping-error"
        >
          {serverErrorMessage(options.error) ??
            "We couldn't check the shipping setup just now."}
        </p>
      ) : (
        <div className="space-y-4">
          {/* Test mode is stated before anything else, because a test label is
              the one failure that looks exactly like success. */}
          {options.data.testMode && (
            <p
              className="rounded-sm border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm font-light"
              data-testid="shipping-test-mode"
            >
              <AlertTriangle
                className="inline w-4 h-4 mr-1.5 -mt-0.5"
                strokeWidth={1.5}
              />
              The shipping vendor is in <strong>test mode</strong>. Labels
              bought here have a tracking number and a PDF, and no carrier will
              carry them. Don't put one on a parcel.
            </p>
          )}

          {blocked ? (
            <div
              className="rounded-sm border border-border bg-card/40 p-4 sm:p-5 space-y-2"
              data-testid="shipping-unavailable"
            >
              <p className="text-sm font-light">
                Labels can't be bought here yet:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                {options.data.problems.map((problem) => (
                  <li
                    key={problem}
                    className="text-sm text-muted-foreground font-light"
                  >
                    {problem}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-sm border border-border bg-card/40 p-4 sm:p-5 space-y-4">
              {options.data.shipFrom && (
                <p
                  className="text-xs text-muted-foreground font-light"
                  data-testid="shipping-from"
                >
                  Posting from {options.data.shipFrom.join(", ")}
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="shipping-order">Shop order number</Label>
                  <Input
                    id="shipping-order"
                    value={orderNumber}
                    placeholder="SHP-M2X4K1-AB12"
                    onChange={(event) => {
                      setOrderNumber(event.target.value);
                      reset();
                    }}
                    data-testid="shipping-order-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="shipping-weight">Weight (ounces)</Label>
                  <Input
                    id="shipping-weight"
                    type="number"
                    min={0}
                    step="0.1"
                    value={weight}
                    placeholder="12"
                    onChange={(event) => {
                      setWeight(event.target.value);
                      reset();
                    }}
                    data-testid="shipping-weight-input"
                  />
                </div>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm mb-2">Packaging</legend>
                <div className="flex flex-wrap gap-2">
                  {parcels.map((parcel: ParcelPreset) => (
                    <button
                      key={parcel.id}
                      type="button"
                      title={`${parcel.hint} — ${parcel.length}×${parcel.width}×${parcel.height} in`}
                      onClick={() => {
                        setParcelId(parcel.id);
                        reset();
                      }}
                      className={`rounded-full border px-3 py-1.5 text-sm font-light transition-colors ${
                        chosenParcel?.id === parcel.id
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                      data-testid={`shipping-parcel-${parcel.id}`}
                    >
                      {parcel.name}
                    </button>
                  ))}
                </div>
                {chosenParcel && (
                  <p className="text-xs text-muted-foreground font-light">
                    {chosenParcel.hint} — {chosenParcel.length}×
                    {chosenParcel.width}×{chosenParcel.height} in
                  </p>
                )}
              </fieldset>

              <Button
                onClick={onQuote}
                disabled={!canQuote}
                data-testid="shipping-quote-button"
              >
                {rates.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                ) : (
                  <Package className="w-4 h-4" strokeWidth={1.5} />
                )}
                Get rates
              </Button>

              {rates.isError && (
                <p
                  className="text-sm text-destructive font-light"
                  data-testid="shipping-rates-error"
                >
                  {serverErrorMessage(rates.error) ??
                    "We couldn't get rates for that parcel."}
                </p>
              )}
            </div>
          )}

          {quote && (
            <RateList
              quote={quote}
              replace={replace}
              onReplaceChange={setReplace}
              confirming={confirming}
              onConfirm={setConfirming}
              onBuy={onBuy}
              buying={purchase.isPending}
            />
          )}

          {purchase.isError && (
            <p
              className="text-sm text-destructive font-light"
              data-testid="shipping-buy-error"
            >
              {serverErrorMessage(purchase.error) ??
                "The label couldn't be bought."}
            </p>
          )}

          {label && <LabelResult label={label} />}
        </div>
      )}
    </section>
  );
}

/** The quoted rates, and the address they'd be posted to. */
function RateList({
  quote,
  replace,
  onReplaceChange,
  confirming,
  onConfirm,
  onBuy,
  buying,
}: {
  quote: ShippingRates;
  replace: boolean;
  onReplaceChange: (value: boolean) => void;
  confirming: ShippingRate | null;
  onConfirm: (rate: ShippingRate | null) => void;
  onBuy: (rate: ShippingRate) => void;
  buying: boolean;
}) {
  return (
    <div
      className="rounded-sm border border-border bg-card/40 p-4 sm:p-5 space-y-4"
      data-testid="shipping-rates"
    >
      <div>
        <p className="text-xs tracking-[0.16em] uppercase text-muted-foreground">
          Posting to
        </p>
        <address className="mt-1 not-italic text-sm font-light whitespace-pre-line">
          {quote.shipTo.join("\n")}
        </address>
      </div>

      {quote.notes.length > 0 && (
        <ul className="space-y-1" data-testid="shipping-rate-notes">
          {quote.notes.map((note) => (
            <li key={note} className="text-xs text-muted-foreground font-light">
              {note}
            </li>
          ))}
        </ul>
      )}

      {quote.rates.length === 0 ? (
        <p
          className="text-sm text-muted-foreground font-light"
          data-testid="shipping-no-rates"
        >
          No connected carrier will take this parcel to that address. Check the
          weight and packaging, or post it through the carrier directly.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {quote.rates.map((rate) => {
              const asking = confirming?.id === rate.id;
              return (
                <li
                  key={rate.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border/60 px-3 py-2.5"
                  data-testid={`shipping-rate-${rate.id}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm">
                      {rate.carrier} · {rate.service}
                    </p>
                    {speed(rate) && (
                      <p className="text-xs text-muted-foreground font-light">
                        {speed(rate)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm tabular-nums">
                      {price(rate.amount, rate.currency)}
                    </span>
                    {/* Money moves on the second press, never the first. */}
                    {asking ? (
                      <span className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => onBuy(rate)}
                          disabled={buying}
                          data-testid={`shipping-confirm-${rate.id}`}
                        >
                          {buying && (
                            <Loader2
                              className="w-3.5 h-3.5 animate-spin"
                              strokeWidth={1.5}
                            />
                          )}
                          Buy for {price(rate.amount, rate.currency)}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onConfirm(null)}
                        >
                          Cancel
                        </Button>
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onConfirm(rate)}
                        disabled={buying}
                        data-testid={`shipping-buy-${rate.id}`}
                      >
                        Buy label
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Deliberately below the list and off by default: an order that
              already has a label is refused by the server, and this is the
              explicit "yes, the first one was voided" the refusal asks for. */}
          <label className="flex items-start gap-2 text-xs text-muted-foreground font-light">
            <input
              type="checkbox"
              checked={replace}
              onChange={(event) => onReplaceChange(event.target.checked)}
              className="mt-0.5"
              data-testid="shipping-replace"
            />
            <span>
              Buy another label even though this order already has tracking on
              it — for when the first was voided and needs replacing.
            </span>
          </label>
        </>
      )}
    </div>
  );
}

/** What was bought, and whether the order took it. */
function LabelResult({ label }: { label: PurchasedLabel }) {
  return (
    <div
      className={`rounded-sm border p-4 sm:p-5 space-y-3 ${
        label.recorded
          ? "border-emerald-600/40 bg-emerald-600/5"
          : "border-amber-500/50 bg-amber-500/5"
      }`}
      data-testid="shipping-label-result"
    >
      <p className="flex items-center gap-2 text-base font-serif">
        {label.recorded ? (
          <CheckCircle2
            className="w-4 h-4 text-emerald-600"
            strokeWidth={1.5}
          />
        ) : (
          <AlertTriangle className="w-4 h-4 text-amber-600" strokeWidth={1.5} />
        )}
        {label.recorded
          ? "Label bought"
          : "Label bought — but the order didn't record it"}
      </p>

      <p className="text-sm font-light">
        {label.carrier} {label.service} for order {label.orderNumber},{" "}
        {price(label.amount, label.currency)}
        {label.testMode && " (test mode — no carrier will carry this)"}.
      </p>

      <p className="text-sm">
        Tracking:{" "}
        <span className="font-mono select-all" data-testid="shipping-tracking">
          {label.trackingNumber}
        </span>
      </p>

      {!label.recorded && (
        <p className="text-sm font-light" data-testid="shipping-not-recorded">
          The label is paid for and valid, but the tracking number couldn't be
          written to the order — so the customer's tracking page won't show it.
          Paste the number above into the order's{" "}
          <strong>Tracking Number</strong> in Notion.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {label.labelUrl && (
          <a
            href={label.labelUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm underline underline-offset-4"
            data-testid="shipping-label-pdf"
          >
            Print the label
            <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.5} />
          </a>
        )}
        {label.trackingUrl && (
          <a
            href={label.trackingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm underline underline-offset-4"
          >
            Track it
            <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.5} />
          </a>
        )}
      </div>
    </div>
  );
}
