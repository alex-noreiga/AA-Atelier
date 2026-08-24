// How a finished piece reaches the customer — shipped, or collected in person —
// resolved from the handful of Notion properties the atelier fills in on an
// order. Pure: no Notion, no HTTP, no clock. Both order kinds (custom orders and
// shop orders) read their own property names into the same {@link FulfilmentFields}
// and hand them here, so the tracking page answers "where is my order?" the same
// way either side (`services/orders.service.ts`, `services/shop-orders.service.ts`).
//
// The point of the split is the local customer. Plenty of the studio's skaters
// collect at the rink or the studio door, so their order has no tracking number
// and never will — and a tracking panel that stays empty forever reads as the
// site being broken rather than as "there is nothing to track". A pickup order
// answers with its scheduled collection time instead.

/** Whether the order is shipped to the customer or collected in person. */
export type DeliveryMethod = "ship" | "pickup";

/**
 * The raw Notion values a fulfilment view is built from, already read off the
 * page by each database's own schema module. Every field is optional — the
 * properties are additive, so an order (or a whole database) that predates them
 * simply reads back empty.
 */
export interface FulfilmentFields {
  /** The `Delivery Method` select, verbatim (e.g. "Local pickup"). */
  method?: string;
  /** The custom order's `Fulfilment` select, verbatim (e.g. "Packed"). */
  state?: string;
  trackingNumber?: string;
  carrier?: string;
  trackingUrl?: string;
  /** The `Ship By` date, as Notion's `start` (may carry a time). */
  shipBy?: string;
  /** The `Pickup Time` date, as Notion's `start` (with a time when set). */
  pickupAt?: string;
  pickupLocation?: string;
}

/** The customer-facing fulfilment view. Mirrors the contract's `OrderFulfilment`. */
export interface FulfilmentView {
  method: DeliveryMethod;
  state?: string;
  tracking?: { number: string; carrier?: string; url?: string };
  shipBy?: string;
  pickup?: { at?: string; location?: string; timezone?: string };
}

/** Normalize a select value for matching: lowercased, punctuation-insensitive. */
function normalize(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/**
 * Whether a human label means "the customer collects this in person".
 *
 * Matched on words rather than an exact value, because the label is the
 * atelier's to write and this must not hinge on them spelling it the way the
 * code does: "Local pickup", "Pick up at studio" and "Customer collects" all
 * read as pickup.
 *
 * Shared deliberately: it decides both what the Notion `Delivery Method` select
 * means and — at checkout — whether the shipping rate the customer chose in
 * Stripe is a collection rather than a posting. One vocabulary, so the rate the
 * customer picks and the column the atelier reads can't disagree about what
 * counts as a pickup.
 */
export function looksLikePickup(raw: string | undefined): boolean {
  return /\b(pickup|pick up|collect|collects|collection)\b/.test(
    normalize(raw),
  );
}

/**
 * What the atelier's `Delivery Method` select says, or undefined when it's
 * blank or says something neither vocabulary recognizes.
 */
function declaredMethod(raw: string | undefined): DeliveryMethod | undefined {
  const value = normalize(raw);
  if (!value) return undefined;
  if (looksLikePickup(value)) return "pickup";
  if (
    /\b(ship|shipping|shipped|mail|post|courier|deliver|delivery)\b/.test(value)
  ) {
    return "ship";
  }
  return undefined;
}

/**
 * Decide whether an order is shipped or collected.
 *
 * The declared `Delivery Method` wins — **unless** the order carries the facts
 * of the other kind and none of its own. A "Ship" order with a pickup time and
 * no tracking number is a pickup; a "Local pickup" order with a tracking number
 * and no pickup details is a shipment. A label with nothing behind it loses to a
 * fact, which is what makes a wrong default on the database template (every new
 * order pre-set to one method) cost nothing: the moment the atelier schedules a
 * collection or enters a tracking number, the order reads correctly.
 *
 * With nothing declared it's inferred the same way, defaulting to `ship` —
 * shipping is the shape the app has always assumed, so an untouched order keeps
 * behaving exactly as it did before pickup existed.
 */
export function resolveDeliveryMethod(
  fields: FulfilmentFields,
): DeliveryMethod {
  const pickupFacts = Boolean(fields.pickupAt || fields.pickupLocation);
  // A ship-by date is deliberately NOT a shipping fact: on a pickup order the
  // atelier reads it as "ready by", so counting it would flip every scheduled
  // collection back to a shipment.
  const shipFacts = Boolean(fields.trackingNumber);

  const declared = declaredMethod(fields.method);
  if (declared === "pickup" && shipFacts && !pickupFacts) return "ship";
  if (declared === "ship" && pickupFacts && !shipFacts) return "pickup";
  if (declared) return declared;

  return pickupFacts ? "pickup" : "ship";
}

/** A blank-safe trim: "" and whitespace read as absent. */
function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Notion hands back a date property's `start` as either a bare date
 * (`2026-09-03`) or a local datetime (`2026-09-03T09:00:00.000-05:00`) depending
 * on whether the atelier included a time. A ship-by is a calendar date either
 * way, so keep only the date half — the wall-clock date in the offset Notion
 * wrote, which is the day the atelier meant.
 */
function dateOnly(value: string | undefined): string | undefined {
  const trimmed = text(value);
  return trimmed ? trimmed.slice(0, 10) : undefined;
}

export interface FulfilmentContext {
  /** The IANA zone a pickup time should be read in (the studio's own). */
  timezone: string;
  /**
   * True once the order has reached the last stage/status in its live list —
   * the positional "delivered" test from `services/delivery.ts`, never a stage
   * name. A delivered order drops its ship-by date and handoff state: both
   * describe a leg that has finished, and a past "expected to ship by" reads as
   * a broken promise rather than as history.
   */
  delivered?: boolean;
}

/**
 * Build the customer-facing fulfilment view, or undefined when there is nothing
 * yet to say.
 *
 * A **pickup** order always has something to say, even before a time is
 * arranged: that it is a pickup at all is the answer to "why is there no
 * tracking number?". A **shipped** order says nothing until the atelier gives it
 * something — a tracking number, a ship-by date, or a handoff state — because an
 * empty shipping panel on a garment still being sewn is noise.
 */
export function resolveFulfilment(
  fields: FulfilmentFields,
  { timezone, delivered = false }: FulfilmentContext,
): FulfilmentView | undefined {
  const method = resolveDeliveryMethod(fields);
  const state = delivered ? undefined : text(fields.state);

  if (method === "pickup") {
    const at = text(fields.pickupAt);
    const location = text(fields.pickupLocation);
    return {
      method,
      ...(state ? { state } : {}),
      pickup: {
        ...(at ? { at } : {}),
        ...(location ? { location } : {}),
        // Only a time needs a zone to be read in; a bare date is a bare date.
        ...(at?.includes("T") ? { timezone } : {}),
      },
    };
  }

  const number = text(fields.trackingNumber);
  const tracking = number
    ? {
        number,
        ...(text(fields.carrier) ? { carrier: text(fields.carrier)! } : {}),
        ...(text(fields.trackingUrl) ? { url: text(fields.trackingUrl)! } : {}),
      }
    : undefined;

  // Once it has shipped the tracking is the answer, so the ship-by date goes:
  // keeping it would have the page promise a send date for a parcel already in
  // the post.
  const shipBy = tracking || delivered ? undefined : dateOnly(fields.shipBy);

  if (!tracking && !shipBy && !state) return undefined;

  return {
    method,
    ...(state ? { state } : {}),
    ...(tracking ? { tracking } : {}),
    ...(shipBy ? { shipBy } : {}),
  };
}
