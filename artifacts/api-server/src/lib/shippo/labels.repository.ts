// The two Shippo calls the label flow makes: rate a parcel, then buy one of the
// rates. Everything vendor-shaped lives here — the wire JSON, the two-step
// object model, the failure vocabulary — so the service above reads as "get
// rates, buy a rate" and a different vendor would be a different file.
//
// Shippo's model is a **shipment** (from, to, parcel) that carries a list of
// **rates**, and a **transaction** that turns one rate into a bought label. The
// split is not an implementation detail we could hide: it is the reason the
// dashboard asks twice, because a rate has a price and a service level the
// atelier has to choose between before any money moves.
//
// Both calls are made synchronously (`async: false`). Shippo's default is to
// return immediately with a `QUEUED` object the caller polls, which on a
// serverless function means either holding a request open around a poll loop or
// inventing somewhere to keep the shipment id between two HTTP calls. Rating a
// single domestic parcel resolves in about a second, so the synchronous form is
// both simpler and the one that can actually answer the request it's serving.

import { logger } from "../logger.js";
import { ServiceUnavailableError, BadRequestError } from "../errors.js";
import { getShippoClient, type ShippoClient } from "./client.js";
import type { PostalAddress } from "../shipping/address.js";

/** A parcel, in the units Shippo rates in. */
export interface ParcelDimensions {
  length: number;
  width: number;
  height: number;
  weightOz: number;
}

/** One buyable rate, already narrowed to what the dashboard shows and the buy
 * step needs. `id` is Shippo's rate `object_id` — opaque, short-lived, and the
 * only thing the buy call takes. */
export interface ShippingRate {
  id: string;
  /** The carrier, as the customer will read it: "USPS", "UPS". */
  carrier: string;
  /** The service level: "Priority Mail", "Ground Advantage". */
  service: string;
  /** What the studio pays, in the rate's own currency. */
  amount: number;
  currency: string;
  /** Carrier's own estimate in days, when it gives one. */
  estimatedDays?: number;
  /** The carrier's wording for the delivery window, when it gives one. */
  durationTerms?: string;
}

/** A bought label. */
export interface PurchasedLabel {
  /** Shippo's transaction id, kept for support requests against the vendor. */
  transactionId: string;
  trackingNumber: string;
  /** The carrier's own tracking page, when it gave one. */
  trackingUrl?: string;
  /** The label PDF. Shippo serves these from a signed URL that expires. */
  labelUrl?: string;
  carrier: string;
  service: string;
  amount: number;
  currency: string;
}

// --- Wire shapes (only the fields read) ---

interface ShippoAddressPayload {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
}

interface ShippoRate {
  object_id?: string;
  amount?: string;
  currency?: string;
  provider?: string;
  estimated_days?: number | null;
  duration_terms?: string | null;
  servicelevel?: { name?: string | null; token?: string | null } | null;
}

interface ShippoShipment {
  object_id?: string;
  status?: string;
  rates?: ShippoRate[];
  messages?: Array<{ text?: string | null; source?: string | null }>;
}

interface ShippoTransaction {
  object_id?: string;
  status?: string;
  tracking_number?: string | null;
  tracking_url_provider?: string | null;
  label_url?: string | null;
  messages?: Array<{ text?: string | null; source?: string | null }>;
  rate?: ShippoRate | string | null;
}

function toShippoAddress(address: PostalAddress): ShippoAddressPayload {
  return {
    name: address.name,
    street1: address.street1,
    ...(address.street2 ? { street2: address.street2 } : {}),
    city: address.city,
    state: address.state,
    zip: address.zip,
    country: address.country,
    ...(address.phone ? { phone: address.phone } : {}),
    ...(address.email ? { email: address.email } : {}),
  };
}

/** Shippo returns money as a decimal STRING ("7.45"). Parsed once, here, so no
 * caller ever does arithmetic on the string. */
function toAmount(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The carrier's own messages, which is where Shippo puts "this address doesn't
 * exist" and "your USPS account isn't connected" — the two failures the atelier
 * can actually do something about. */
function messageText(
  messages: Array<{ text?: string | null }> | undefined,
): string[] {
  return (messages ?? [])
    .map((message) => message.text?.trim())
    .filter((text): text is string => Boolean(text));
}

/**
 * Read a Shippo response, or throw with something worth reading.
 *
 * A 4xx is the request's fault and its body usually names the field, so it
 * surfaces as a `BadRequestError` the dashboard shows verbatim. A 5xx or a
 * network failure is the vendor's and clears itself, so it surfaces as a 503
 * with a retriable message — the same split `lib/google/retry.ts` makes, and for
 * the same reason: only one of the two is worth alerting the atelier's inbox
 * about.
 */
async function readJson<T>(response: Response, what: string): Promise<T> {
  if (response.ok) return (await response.json()) as T;

  const body = await response.text();
  logger.error(
    { status: response.status, body, what },
    "Shippo request failed",
  );

  if (response.status >= 400 && response.status < 500) {
    throw new BadRequestError(
      `The shipping vendor rejected the ${what} (status ${response.status}). Check the addresses and parcel details.`,
    );
  }
  throw new ServiceUnavailableError(
    "The shipping vendor isn't responding just now. Please try again in a moment.",
  );
}

/**
 * Rate a parcel between two addresses.
 *
 * Returns the rates **cheapest first**, because that is the order the atelier
 * chooses in — and an empty list is a legitimate, non-error answer: it means no
 * carrier the studio has connected will carry this parcel to this address, which
 * is a thing to say rather than a thing to throw about. The carrier's own
 * messages ride back alongside, since they are what explains an empty list.
 */
export async function fetchShippingRates(
  from: PostalAddress,
  to: PostalAddress,
  parcel: ParcelDimensions,
  client: ShippoClient = getShippoClient(),
): Promise<{ rates: ShippingRate[]; messages: string[] }> {
  const response = await client.fetch("/shipments/", {
    method: "POST",
    body: JSON.stringify({
      address_from: toShippoAddress(from),
      address_to: toShippoAddress(to),
      parcels: [
        {
          length: String(parcel.length),
          width: String(parcel.width),
          height: String(parcel.height),
          distance_unit: "in",
          weight: String(parcel.weightOz),
          mass_unit: "oz",
        },
      ],
      async: false,
    }),
  });

  const shipment = await readJson<ShippoShipment>(response, "rate request");

  const rates = (shipment.rates ?? [])
    .map(toRate)
    .filter((rate): rate is ShippingRate => rate !== null)
    .sort((a, b) => a.amount - b.amount);

  return { rates, messages: messageText(shipment.messages) };
}

/** Narrow one wire rate, dropping any that couldn't be bought anyway. A rate
 * with no `object_id` is unbuyable, and one with no provider is unreadable — in
 * both cases showing it would only offer the atelier a dead choice. */
function toRate(raw: ShippoRate): ShippingRate | null {
  const id = raw.object_id?.trim();
  const carrier = raw.provider?.trim();
  if (!id || !carrier) return null;

  const service = raw.servicelevel?.name?.trim() || "Standard";
  const estimatedDays =
    typeof raw.estimated_days === "number" && raw.estimated_days > 0
      ? raw.estimated_days
      : undefined;
  const durationTerms = raw.duration_terms?.trim() || undefined;

  return {
    id,
    carrier,
    service,
    amount: toAmount(raw.amount),
    currency: raw.currency?.trim() || "USD",
    ...(estimatedDays !== undefined ? { estimatedDays } : {}),
    ...(durationTerms ? { durationTerms } : {}),
  };
}

/**
 * Buy one rate as a label.
 *
 * This is the call that spends money, and the one failure mode worth naming is
 * that Shippo answers **HTTP 201 for a transaction that failed**: the object
 * comes back with `status: "ERROR"` and the reason in `messages`. Reading only
 * the status code would report a label bought, write a blank tracking number
 * onto the order, and tell the atelier to go and print nothing. So the
 * transaction's own status is what decides, and a `SUCCESS` with no tracking
 * number is treated as a failure too — a label nobody can track is not a label.
 */
export async function purchaseLabel(
  rateId: string,
  client: ShippoClient = getShippoClient(),
): Promise<PurchasedLabel> {
  const response = await client.fetch("/transactions/", {
    method: "POST",
    body: JSON.stringify({
      rate: rateId,
      // 4x6 is the thermal-printer format, and prints perfectly well on A4/Letter.
      label_file_type: "PDF_4x6",
      async: false,
    }),
  });

  const transaction = await readJson<ShippoTransaction>(
    response,
    "label purchase",
  );

  const status = transaction.status?.toUpperCase();
  const trackingNumber = transaction.tracking_number?.trim();

  if (status !== "SUCCESS" || !trackingNumber) {
    const reasons = messageText(transaction.messages);
    logger.error(
      { status, reasons, transactionId: transaction.object_id },
      "Shippo label purchase did not succeed",
    );
    throw new BadRequestError(
      reasons.length > 0
        ? `The label couldn't be bought: ${reasons.join(" ")}`
        : "The label couldn't be bought. The rate may have expired — ask for rates again and retry.",
    );
  }

  const rate = typeof transaction.rate === "object" ? transaction.rate : null;

  return {
    transactionId: transaction.object_id?.trim() ?? "",
    trackingNumber,
    ...(transaction.tracking_url_provider?.trim()
      ? { trackingUrl: transaction.tracking_url_provider.trim() }
      : {}),
    ...(transaction.label_url?.trim()
      ? { labelUrl: transaction.label_url.trim() }
      : {}),
    carrier: rate?.provider?.trim() || "",
    service: rate?.servicelevel?.name?.trim() || "",
    amount: toAmount(rate?.amount),
    currency: rate?.currency?.trim() || "USD",
  };
}
