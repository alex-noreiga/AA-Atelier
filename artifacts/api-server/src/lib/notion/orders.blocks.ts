// Builds the Notion page representation of a new order: the page `properties`
// (title + order number) and the `children` block array (contact, measurement,
// and dress-detail sections). Kept separate from the HTTP/Notion request layer
// so the domain-field -> Notion-block mapping is independently testable.

import {
  ORDER_NAME_PROPERTY,
  ORDER_NUMBER_PROPERTY,
  ORDER_EMAIL_PROPERTY,
  ORDER_CLIENT_PROPERTY,
  ORDER_DUE_DATE_PROPERTY,
  ORDER_RUSH_PROPERTY,
  ORDER_WAIST_PROPERTY,
  ORDER_BUST_PROPERTY,
  ORDER_HIPS_PROPERTY,
  ORDER_HEIGHT_PROPERTY,
  ORDER_BODY_GIRTH_PROPERTY,
  ORDER_MEASUREMENT_UNIT_PROPERTY,
  ORDER_COLORS_PROPERTY,
  ORDER_COLOR_USAGE_PROPERTY,
  ORDER_PREFERRED_CONTACT_PROPERTY,
  ORDER_MEASUREMENT_APPOINTMENT_PROPERTY,
  ORDER_REFERRAL_CODE_PROPERTY,
  ORDER_SERVICE_PROPERTY,
  type CreateOrderInput,
} from "./orders.schema.js";
import { normalizeEmail } from "../email.js";
import { resolveOrderService } from "../service-catalog.js";

/** Format the customer's "needed by" value as a Notion date string
 * (`YYYY-MM-DD`). The contract coerces it to a `Date`, but we defend against a
 * raw string reaching the builder. */
function formatNeededBy(neededBy: NonNullable<CreateOrderInput["neededBy"]>) {
  return neededBy instanceof Date
    ? neededBy.toISOString().split("T")[0]
    : String(neededBy);
}

function textBlock(label: string, value: string) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        {
          type: "text",
          text: { content: `${label}: ` },
          annotations: { bold: true },
        },
        { type: "text", text: { content: value } },
      ],
    },
  };
}

function headingBlock(text: string) {
  return {
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [{ type: "text", text: { content: text } }],
    },
  };
}

function dividerBlock() {
  return { object: "block", type: "divider", divider: {} };
}

/** An image block backed by an already-uploaded Notion `file_upload` id (see
 * `file-uploads.repository.ts`). Notion renders it inline on the order page. */
function imageBlock(fileUploadId: string) {
  return {
    object: "block",
    type: "image",
    image: { type: "file_upload", file_upload: { id: fileUploadId } },
  };
}

/**
 * Notion page `properties` for a new order. When `clientPageId` is given (the
 * order flow upserted a Client CRM record for this customer), the order is
 * linked to it through the `Client` relation.
 */
export function buildOrderProperties(
  data: CreateOrderInput,
  orderNumber: string,
  clientPageId?: string,
): Record<string, unknown> {
  // Which service this order is for. It names the piece in the page title and is
  // written as its own property below; everything downstream (which sections the
  // page body carries) reads the same entry, so an order can't be titled one
  // thing and shaped like another.
  const service = resolveOrderService(data.service);
  const properties: Record<string, unknown> = {
    [ORDER_NAME_PROPERTY]: {
      title: [
        { text: { content: `${data.fullName} – ${service.orderLabel}` } },
      ],
    },
    // Recorded on every order (the contract's `service` is optional, but it
    // always resolves to a catalog entry), so the atelier can filter the
    // pipeline by the kind of work rather than reading it out of the title.
    [ORDER_SERVICE_PROPERTY]: {
      select: { name: service.name },
    },
    [ORDER_NUMBER_PROPERTY]: {
      rich_text: [{ text: { content: orderNumber } }],
    },
    // Also written as a property (not only in the Contact body block) so a
    // later measurement-change request can be verified against it server-side.
    [ORDER_EMAIL_PROPERTY]: {
      email: normalizeEmail(data.email),
    },
    // How the customer asked to be reached. Always present (the contract requires
    // it), so unlike the optional properties below it needs no guard.
    [ORDER_PREFERRED_CONTACT_PROPERTY]: {
      select: { name: data.preferredContact },
    },
  };
  // The customer's "needed by" date is the atelier's target completion date, so
  // seed the `Due Date` property from it directly at intake. The atelier can
  // still adjust it in Notion; the milestone-reconciliation cron then picks the
  // order up (see schedule.service.ts).
  if (data.neededBy) {
    properties[ORDER_DUE_DATE_PROPERTY] = {
      date: { start: formatNeededBy(data.neededBy) },
    };
  }
  // A confirmed rush order — flag it so the atelier prices the surcharge into
  // the invoice. Only written when true (Notion leaves an unset checkbox false).
  if (data.rush) {
    properties[ORDER_RUSH_PROPERTY] = { checkbox: true };
  }
  // Measurements as typed properties (mirrors the page-body block section below),
  // so the account portal can read them back — the resolution of the old
  // TODO(measurements-b). Written only when the customer supplied values now (the
  // intake requires all five together); a measure-at-fitting order leaves them
  // unset. `bust` maps to the "Chest" property.
  if (data.waist !== undefined) {
    properties[ORDER_WAIST_PROPERTY] = { number: data.waist };
    properties[ORDER_BUST_PROPERTY] = { number: data.bust };
    properties[ORDER_HIPS_PROPERTY] = { number: data.hips };
    properties[ORDER_HEIGHT_PROPERTY] = { number: data.height };
    properties[ORDER_BODY_GIRTH_PROPERTY] = { number: data.bodyGirth };
    properties[ORDER_MEASUREMENT_UNIT_PROPERTY] = {
      select: { name: data.measurementUnit },
    };
  }
  // The other branch of the same choice: the customer asked to be measured at a
  // fitting/consultation. Written only when true (an unset checkbox reads false),
  // so the atelier can filter for the orders still waiting on measurements.
  if (data.measurementAppointment) {
    properties[ORDER_MEASUREMENT_APPOINTMENT_PROPERTY] = { checkbox: true };
  }
  // The customer's color choices from the intake palette — a multi_select of the
  // picked color names (filterable) + a free-text usage note. Write-only; the app
  // never reads them back. Each written only when supplied.
  if (data.colors && data.colors.length > 0) {
    properties[ORDER_COLORS_PROPERTY] = {
      multi_select: data.colors.map((name) => ({ name })),
    };
  }
  if (data.colorUsage) {
    properties[ORDER_COLOR_USAGE_PROPERTY] = {
      rich_text: [{ text: { content: data.colorUsage } }],
    };
  }
  // The referral code as typed. Recorded even when it resolves to nothing — the
  // reward engine's own state lives on the Client CRM (see rewards.service.ts);
  // this is the atelier's record of what the customer entered.
  if (data.referralCode) {
    properties[ORDER_REFERRAL_CODE_PROPERTY] = {
      rich_text: [{ text: { content: data.referralCode } }],
    };
  }
  if (clientPageId) {
    properties[ORDER_CLIENT_PROPERTY] = {
      relation: [{ id: clientPageId }],
    };
  }
  return properties;
}

/** Notion page body (`children`) blocks for a new order. */
export function buildOrderPageBlocks(data: CreateOrderInput): unknown[] {
  const service = resolveOrderService(data.service);

  const contactSection = [
    headingBlock("Contact Information"),
    textBlock("Full Name", data.fullName),
    textBlock("Email", data.email),
    textBlock("Phone", data.phone),
    textBlock("Preferred Contact", data.preferredContact),
    // Mirrors the `Service` property above so the page reads complete without
    // opening the property panel — the same treatment as the referral code.
    textBlock("Service", service.name),
    dividerBlock(),
  ];

  // Measurements are optional: the customer either provided them, or asked to
  // have them taken at a fitting/consultation. Render whichever applies so the
  // atelier can tell the two apart at a glance. These body blocks are the
  // atelier's readable page view; the same values are also written as typed
  // properties in `buildOrderProperties` (the read source for the account portal),
  // both from this one intake payload so they can't drift. A later in-place edit
  // rewrites the properties and APPENDS a revision section below this one rather
  // than rewriting it — see `buildMeasurementRevisionBlocks`.
  //
  // A service that isn't asking for body measurements (alterations,
  // rhinestoning, a repair — all measured on the piece itself, in person) omits
  // the section entirely rather than printing "to be taken at an appointment"
  // for work where none is owed.
  const providedMeasurements = data.waist !== undefined;
  const measurementSection = !service.measurements
    ? []
    : providedMeasurements
      ? [
          headingBlock(`Measurements (${data.measurementUnit})`),
          textBlock("Waist", String(data.waist)),
          textBlock("Chest", String(data.bust)),
          textBlock("Hips", String(data.hips)),
          textBlock("Height", String(data.height)),
          textBlock("Body Girth", String(data.bodyGirth)),
          dividerBlock(),
        ]
      : [
          headingBlock("Measurements"),
          textBlock(
            "Status",
            "To be taken at a scheduled fitting or consultation appointment.",
          ),
          dividerBlock(),
        ];

  const costumeSection: unknown[] = [headingBlock("Costume Details")];
  // The free-text brief, under the label this service asked for it with — for a
  // repair that heading is "The piece and what needs repairing", not "Description".
  if (data.description) {
    costumeSection.push(textBlock(service.detailsLabel, data.description));
  }
  if (data.neededBy) {
    costumeSection.push(textBlock("Needed By", formatNeededBy(data.neededBy)));
  }
  // Surface a confirmed rush order in the page body too, so the atelier sees it
  // at a glance alongside the due date and knows to add the rush surcharge.
  if (data.rush) {
    costumeSection.push(
      textBlock("Rush Order", "Yes — rush surcharge applies"),
    );
  }
  // The customer's color choices from the intake palette + how they'd like them
  // used, each omitted when not supplied.
  if (data.colors && data.colors.length > 0) {
    costumeSection.push(textBlock("Colors", data.colors.join(", ")));
  }
  if (data.colorUsage) {
    costumeSection.push(textBlock("Color Usage", data.colorUsage));
  }
  // Who sent them, as typed. Mirrors the `Referral Code` property above so the
  // page reads complete without opening the property panel.
  if (data.referralCode) {
    costumeSection.push(textBlock("Referral Code", data.referralCode));
  }
  costumeSection.push(dividerBlock());

  // Customer-uploaded reference / inspiration images, attached as inline image
  // blocks by their Notion file_upload id (uploaded ahead of order-create via
  // POST /orders/reference-images). Omitted entirely when none were uploaded.
  const referenceSection: unknown[] =
    data.referenceImageIds && data.referenceImageIds.length > 0
      ? [
          headingBlock("Reference Images"),
          ...data.referenceImageIds.map(imageBlock),
          dividerBlock(),
        ]
      : [];

  return [
    ...contactSection,
    ...measurementSection,
    ...costumeSection,
    ...referenceSection,
  ];
}

// ---------------------------------------------------------------------------
// In-place measurement editing
//
// The second writer of the measurement properties, after intake. Everything
// about a measurement lives in two places on the order page — the typed
// properties (what the app reads back) and the page-body section (what the
// atelier reads at a glance) — so an edit that touched only one of them would
// leave the two disagreeing about what the garment is cut to. These two
// builders are the edit's half of that pair, kept here beside the intake
// builders they mirror so the property names can't drift.
// ---------------------------------------------------------------------------

/** The five body measurements plus the unit they're expressed in — the complete
 * set an in-place edit replaces. Deliberately not `Partial`: a half-written set
 * is the failure mode this feature must not have. */
export interface MeasurementValues {
  waist: number;
  bust: number;
  hips: number;
  height: number;
  bodyGirth: number;
  measurementUnit: "inches" | "cm";
}

/** Human labels for the five values, in the order the intake form and the page
 * body already present them. `bust` renders as "Chest" — the same neutralized
 * label the property carries. */
export const MEASUREMENT_LABELS: ReadonlyArray<
  readonly [keyof Omit<MeasurementValues, "measurementUnit">, string]
> = [
  ["waist", "Waist"],
  ["bust", "Chest"],
  ["hips", "Hips"],
  ["height", "Height"],
  ["bodyGirth", "Body Girth"],
] as const;

/**
 * The Notion property patch for an in-place measurement edit — the five numbers
 * and the unit, exactly the set {@link buildOrderProperties} writes at intake.
 *
 * It writes all six together rather than only what changed, because the unit is
 * what gives the numbers meaning: rewriting a waist without its unit is how 26
 * inches silently becomes 26 centimetres.
 */
export function buildMeasurementProperties(
  values: MeasurementValues,
): Record<string, unknown> {
  return {
    [ORDER_WAIST_PROPERTY]: { number: values.waist },
    [ORDER_BUST_PROPERTY]: { number: values.bust },
    [ORDER_HIPS_PROPERTY]: { number: values.hips },
    [ORDER_HEIGHT_PROPERTY]: { number: values.height },
    [ORDER_BODY_GIRTH_PROPERTY]: { number: values.bodyGirth },
    [ORDER_MEASUREMENT_UNIT_PROPERTY]: {
      select: { name: values.measurementUnit },
    },
  };
}

/**
 * The page-body blocks recording one measurement revision — appended to the
 * order page, never overwriting the intake section above it.
 *
 * Appending rather than rewriting is the load-bearing choice. The atelier reads
 * the page body, and a garment already part-made was cut to the numbers that
 * were there before; silently replacing them would destroy the only record of
 * what the piece was actually built to. So the page reads chronologically —
 * what was taken at intake, then each revision with its previous values beside
 * the new ones — and the typed properties (which the app reads) always hold the
 * current set. The `previous` values are optional because an order placed
 * before the measurement properties existed has none stored to compare against.
 */
export function buildMeasurementRevisionBlocks(input: {
  values: MeasurementValues;
  previous?: Partial<Record<keyof MeasurementValues, number | string>>;
  note?: string;
  /** The revision's date, as the customer-facing string to stamp on the
   * heading. Passed in rather than read from the clock here, so the builder
   * stays pure and testable. */
  changedOn: string;
}): unknown[] {
  const { values, previous, note, changedOn } = input;
  const unitChanged =
    previous?.measurementUnit !== undefined &&
    previous.measurementUnit !== values.measurementUnit;

  return [
    dividerBlock(),
    headingBlock(
      `Measurements updated ${changedOn} (${values.measurementUnit})`,
    ),
    textBlock(
      "Source",
      unitChanged
        ? `Edited by the customer. Previously recorded in ${String(previous?.measurementUnit)}.`
        : "Edited by the customer from their order page.",
    ),
    ...MEASUREMENT_LABELS.map(([key, label]) => {
      const was = previous?.[key];
      // "was" is shown only when there is something to compare against, and
      // only when it actually differs — a revision listing five unchanged
      // values as changes reads as noise the atelier learns to skim past.
      const suffix =
        was !== undefined && Number(was) !== values[key] ? ` (was ${was})` : "";
      return textBlock(label, `${values[key]}${suffix}`);
    }),
    ...(note ? [textBlock("Customer note", note)] : []),
    dividerBlock(),
  ];
}
