// The intake service catalog: what a customer can commission, and which parts
// of the order form each service actually needs.
//
// This is a *targeted business rule* deliberately encoded in code — the same
// call as `lib/appointments/catalog.ts` (and `STATUS_IN_STOCK` /
// `MEASUREMENT_LOCK_FROM_STAGE`) rather than read live from Notion. Each entry's
// flags drive server-side validation (`enforceServiceGate` in
// `services/orders.service.ts`) *and*, through `GET /services`, which sections
// the intake form renders. Serving the one definition is the point: the form and
// the gate cannot disagree about whether a repair needs body measurements.
//
// The names mirror the four services advertised on the Services page
// (`web-app/src/pages/services.tsx`) — keep them in step, and note that the ids
// are what `/order?service=…` deep links and stored orders carry, so renaming an
// id is a breaking change while renaming a `name` is not.

export interface OrderServiceDef {
  id: string;
  name: string;
  /** One line describing the service, shown beside it on the intake picker. */
  summary: string;
  /**
   * Whether this service asks for the five body measurements (entered now, or
   * deferred to a fitting). Only a garment made from scratch needs them: an
   * alteration, a stoning job, or a repair is measured on the piece itself, in
   * person. False here means the form omits the section entirely *and* the
   * server stops requiring values-or-an-appointment.
   */
  measurements: boolean;
  /** Whether the studio colour palette + usage note are offered. */
  colors: boolean;
  /**
   * Whether the order's free-text `description` is required. True for the
   * services performed on a piece the customer already owns, where that
   * description *is* the brief; false for a bespoke commission, whose design
   * notes are genuinely optional (the design is settled at consultation). The
   * counterpart of the appointment catalog's `requiresProjectDetails`.
   */
  detailsRequired: boolean;
  /** Field label for `description` on this service's form. */
  detailsLabel: string;
  /** Placeholder / prompt for `description` on this service's form. */
  detailsHelp: string;
  /**
   * Suffix for the Notion order title (`"<name> – <orderLabel>"`) and the word
   * the confirmation email uses for the work. Server-side only — it is the
   * atelier's and the customer's wording, not something the form renders, so it
   * stays off the contract.
   */
  orderLabel: string;
  /**
   * The opening line of the customer's confirmation email, after the greeting.
   * Kept here so a service's whole character lives in one entry rather than
   * being reassembled by the mailer.
   */
  emailIntro: string;
}

export const ORDER_SERVICES: readonly OrderServiceDef[] = [
  {
    id: "bespoke",
    name: "Bespoke Commission",
    summary: "A costume designed and made for you from scratch.",
    measurements: true,
    colors: true,
    detailsRequired: false,
    detailsLabel: "Description",
    detailsHelp:
      "Tell us about your vision — style, silhouette, special requirements...",
    orderLabel: "Custom Costume",
    emailIntro:
      "Thank you for trusting us with your custom piece. We've received your order and our atelier will begin the journey from measurements to finished garment.",
  },
  {
    id: "alterations",
    name: "Fittings & Alterations",
    summary: "Adjustments to a piece you already have, fitted in person.",
    measurements: false,
    colors: false,
    detailsRequired: true,
    detailsLabel: "The piece and what needs adjusting",
    detailsHelp:
      "Tell us about the costume and what you'd like changed — where it's tight or loose, hem length, straps...",
    orderLabel: "Alterations",
    emailIntro:
      "Thank you for trusting us with your costume. We've received your alteration request, and we'll be in touch to arrange a fitting so we can see the piece on you.",
  },
  {
    id: "rhinestoning",
    name: "Rhinestoning & Embellishment",
    summary: "Crystals, beading, and detailing applied by hand.",
    measurements: false,
    colors: true,
    detailsRequired: true,
    detailsLabel: "The piece and the stoning you'd like",
    detailsHelp:
      "Tell us about the costume and the coverage you're picturing — full stoning, bodice only, a scattered pattern...",
    orderLabel: "Rhinestoning",
    emailIntro:
      "Thank you for trusting us with your costume. We've received your rhinestoning request, and we'll be in touch to confirm the detail, the stones, and the timing.",
  },
  {
    id: "repairs",
    name: "Repairs & Restoration",
    summary: "Mending and restoring a costume you love.",
    measurements: false,
    colors: false,
    detailsRequired: true,
    detailsLabel: "The piece and what needs repairing",
    detailsHelp:
      "Tell us about the costume and what's happened to it — lost stones, a torn seam, worn elastic...",
    orderLabel: "Repair",
    emailIntro:
      "Thank you for trusting us with your costume. We've received your repair request, and we'll be in touch about getting the piece to us.",
  },
];

/**
 * The service an order with no (or an unrecognized) `service` is treated as.
 * A bespoke commission is the widest form and the behavior every order had
 * before the catalog existed, so an old client — or an id we've since retired —
 * degrades to exactly what it used to do rather than losing a gate.
 */
export const DEFAULT_SERVICE_ID = "bespoke";

export function getOrderService(id: string): OrderServiceDef | undefined {
  return ORDER_SERVICES.find((service) => service.id === id);
}

/** The catalog entry for an order's `service`, falling back to the default. */
export function resolveOrderService(id?: string): OrderServiceDef {
  const match = id ? getOrderService(id) : undefined;
  // The default is the first entry by construction; the `?? ORDER_SERVICES[0]`
  // is only so the return type isn't optional.
  return match ?? getOrderService(DEFAULT_SERVICE_ID) ?? ORDER_SERVICES[0];
}

/** The catalog as the intake form consumes it (`GET /services`). */
export function getServiceOptions(): {
  services: Array<{
    id: string;
    name: string;
    summary: string;
    measurements: boolean;
    colors: boolean;
    detailsRequired: boolean;
    detailsLabel: string;
    detailsHelp: string;
  }>;
} {
  return {
    services: ORDER_SERVICES.map(
      ({ orderLabel: _orderLabel, emailIntro: _emailIntro, ...option }) =>
        option,
    ),
  };
}
