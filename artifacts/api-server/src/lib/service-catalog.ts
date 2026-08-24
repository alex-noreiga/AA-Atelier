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
   * How this service's work is paid for.
   *
   * `"staged"` is the bespoke commission's schedule and the shape the whole
   * payment system was built around: a first deposit once the sketch is
   * finalized, a second at the first fitting, then the final balance after
   * delivery. `"single"` is the three piece-in-hand services — a repair, a
   * stoning job or an alteration is quoted as one price and paid once, because
   * there is no sketch to finalize and (for two of the three) no fitting to
   * take a second deposit at.
   *
   * This changes NOTHING about what the invoice can hold — all three stages
   * stay available on every order, because the atelier may genuinely want money
   * up front on an expensive restoration. It changes only what the stages are
   * CALLED (`services/payment-labels.ts`): "First deposit" is wrong wording on a
   * one-off job, and wrong wording on a payment screen is how a customer comes
   * to believe there is a second instalment coming.
   */
  payment: PaymentSchedule;
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
  /**
   * Which production stages this service's orders walk — the order's *pipeline*,
   * over the one superset of `Stage` options the atelier keeps in Notion.
   *
   * Two shapes, because the four services fall into two genuinely different
   * relationships with that superset:
   *
   * - `{ kind: "select" }` — the service walks these named stages, in **this
   *   order**. Used by the three services performed on a piece the customer
   *   already owns, each of which touches a handful of the superset.
   * - `{ kind: "exclude" }` — the service walks the whole live list *except*
   *   these. Used by the bespoke commission, whose pipeline **is** the superset
   *   minus the stages that exist only for the other three. Written as an
   *   exclusion so the atelier keeps the property they have always had: add,
   *   rename or reorder a commission stage in Notion and it appears on the
   *   commission timeline with no deploy. A select-list would have quietly
   *   taken that away the moment the superset stopped being the commission's
   *   own list.
   *
   * Either way this names live option values without owning the list — the same
   * targeted-business-rule exception as `STATUS_IN_STOCK` /
   * `MEASUREMENT_LOCK_FROM_STAGE`. A selected name that no longer matches a live
   * option is dropped by `resolveOrderPipeline` (so one Notion rename costs one
   * step, not the timeline), and a selection matching nothing at all degrades to
   * the full live list. An excluded name that matches nothing is simply inert.
   *
   * For a selection, ORDER MATTERS and is this catalog's to decide: an
   * alteration is pinned at a fitting *before* the work is done on it. Keep a
   * selection in the superset's own order where you can — see the
   * `Milestone Status` note in `.agents/memory/service-pipelines.md`.
   *
   * Omitted entirely ⇒ the whole live list. No entry does that today; it is the
   * floor `resolveOrderPipeline` degrades to for a service it can't resolve.
   */
  pipeline?: ServicePipeline;
}

/**
 * How a service's payments are scheduled — see `OrderServiceDef.payment`.
 * Deliberately a two-value union rather than a list of stage labels: the stages
 * themselves are fixed by the invoice's Notion properties, so a service chooses
 * between two ways of describing them, not its own set.
 */
export type PaymentSchedule = "staged" | "single";

/** How a service's entry selects its stages from the live superset. */
export type ServicePipeline =
  | { kind: "select"; stages: readonly string[] }
  | { kind: "exclude"; stages: readonly string[] };

/**
 * Stages that exist in the superset for one of the three piece-in-hand services
 * and have no place on a bespoke commission's timeline.
 *
 * Named once, here, because two things must agree about them: the bespoke
 * exclusion below, and `test/unit/order-pipeline.test.ts`, which asserts every
 * stage any service selects is either walked or excluded by the commission — so
 * adding a service stage without deciding about bespoke fails CI rather than
 * quietly putting "Repair/Restoration" on a commission's tracking page.
 */
export const PIECE_IN_HAND_STAGES = [
  "Piece Received",
  "Alteration/Adjustment",
  "Repair/Restoration",
] as const;

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
    payment: "staged",
    orderLabel: "Custom Costume",
    emailIntro:
      "Thank you for trusting us with your custom piece. We've received your order and our atelier will begin the journey from measurements to finished garment.",
    // The commission's pipeline IS the superset, minus the stages that only
    // exist for a piece the customer already owns. Stated as an exclusion so a
    // stage the atelier adds in Notion still reaches this timeline untouched.
    pipeline: { kind: "exclude", stages: PIECE_IN_HAND_STAGES },
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
    payment: "single",
    orderLabel: "Alterations",
    emailIntro:
      "Thank you for trusting us with your costume. We've received your alteration request, and we'll be in touch to arrange a fitting so we can see the piece on you.",
    // The piece arrives, is pinned on the customer, then adjusted. There is no
    // sketching, sourcing or pattern drafting — the garment already exists, and
    // "Cutting/Pinning" would describe building one from scratch.
    pipeline: {
      kind: "select",
      stages: [
        "Consultation",
        "Piece Received",
        "Fitting",
        "Alteration/Adjustment",
        "Ready for delivery/pickup",
        "Delivered",
      ],
    },
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
    payment: "single",
    orderLabel: "Rhinestoning",
    emailIntro:
      "Thank you for trusting us with your costume. We've received your rhinestoning request, and we'll be in touch to confirm the detail, the stones, and the timing.",
    // The piece arrives, stones are sourced, then applied. Nothing is drafted,
    // cut or constructed.
    pipeline: {
      kind: "select",
      stages: [
        "Consultation",
        "Piece Received",
        "Sourcing",
        "Rhinestoning/Detailing",
        "Ready for delivery/pickup",
        "Delivered",
      ],
    },
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
    payment: "single",
    orderLabel: "Repair",
    emailIntro:
      "Thank you for trusting us with your costume. We've received your repair request, and we'll be in touch about getting the piece to us.",
    // The piece arrives, matching materials are sourced, then it is mended.
    // "Sewing/Construction" would read to a customer as their garment being
    // built from scratch, which is the opposite of what a repair is.
    pipeline: {
      kind: "select",
      stages: [
        "Consultation",
        "Piece Received",
        "Sourcing",
        "Repair/Restoration",
        "Ready for delivery/pickup",
        "Delivered",
      ],
    },
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

/**
 * The catalog entry for a service as a *stored order* names it, falling back to
 * the default.
 *
 * An order's `Service` Notion property holds the human-readable `name`
 * ("Fittings & Alterations"), because the atelier reads and filters that column
 * — while the contract's `service`, deep links, and this catalog's own lookups
 * use the `id` ("alterations"). So reading a service back off an order has to
 * accept either, or resolving a stored order would always miss and quietly hand
 * every order the default pipeline.
 *
 * Names are matched case- and whitespace-insensitively, which keeps the
 * catalog's promise that renaming a `name` is not a breaking change: a rename
 * that does drift past this match resolves to the bespoke commission, i.e. the
 * full live stage list — the same widest-form degradation as an unknown id.
 */
export function resolveStoredOrderService(value?: string): OrderServiceDef {
  const trimmed = value?.trim();
  if (!trimmed) return resolveOrderService(undefined);

  const byId = getOrderService(trimmed);
  if (byId) return byId;

  const folded = trimmed.toLowerCase();
  const byName = ORDER_SERVICES.find(
    (service) => service.name.trim().toLowerCase() === folded,
  );
  return byName ?? resolveOrderService(undefined);
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
      ({
        orderLabel: _orderLabel,
        emailIntro: _emailIntro,
        // How the work is paid for is the invoice's business, not the intake
        // form's: the form asks what to make, and the payment stages reach the
        // customer on `OrderStatus.deposits` once there is an invoice to pay.
        payment: _payment,
        // The pipeline is the tracking page's business, not the intake form's:
        // the form asks what to make, and the order's stage list reaches the
        // customer on `OrderStatus.stages` once there is an order to track.
        pipeline: _pipeline,
        ...option
      }) => option,
    ),
  };
}
