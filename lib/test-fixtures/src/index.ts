// Shared domain fixtures for the test suites (api-server Vitest, web-app
// Vitest, and the Playwright e2e specs).
//
// GUARDRAIL — read before adding anything here:
//
// A fixture in this module may only ever be a *stub input*: a request body, a
// mocked repository return, a stubbed hook result, a mocked HTTP response. It
// must never be the *expected output* of the mapper that consumes it. If the
// same constant is both fed into a mapper and asserted against its result, a
// bug in the fixture cancels a bug in the mapper and the test asserts nothing.
//
// Concretely: the Notion-wire-shaped builders (raw Notion page JSON —
// `orderPage()`, `databaseSchemaWithStages()`) stay local to
// `artifacts/api-server/test/support/fake-notion.ts`. They are a different
// layer from the DTOs below, and keeping them apart is what lets
// `schema.test.ts` take its input from one place and write its expectation in
// another.
//
// The types come from the generated `@workspace/api-zod` package (the OpenAPI
// contract), so a fixture cannot silently drift from the API it stands in for.

import type {
  CheckoutSessionStatus,
  ColorList,
  NewCancellationRequest,
  NewContactRequest,
  NewMeasurementChangeRequest,
  NewNewsletterRequest,
  NewNotifyRequest,
  NewOrderRequest,
  NewReturnRequest,
  NewReviewRequest,
  OrderStatus,
  ProductList,
  ServiceList,
} from "@workspace/api-zod";

// Re-export the generated contract types the e2e mock helpers type against, so
// the `tests` package (which depends on this package, not on `@workspace/api-zod`
// directly) can annotate mock bodies without drifting from the API.
export type { OrderStatus } from "@workspace/api-zod";

/** The stage vocabulary used by the status-lookup fixtures. */
export const STAGES = ["Consultation", "Sewing/Construction", "Delivery"];

/** The error envelope the API returns for an unhandled failure. */
export const GENERIC_ERROR = "Something went wrong. Please try again later.";

/** A valid new-order payload. Every required field, no optional ones. */
export function createOrderInput(
  overrides: Partial<NewOrderRequest> = {},
): NewOrderRequest {
  return {
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+1 555 000 1234",
    preferredContact: "email",
    measurementUnit: "inches",
    waist: 28,
    bust: 36,
    hips: 38,
    height: 65,
    bodyGirth: 32,
    ...overrides,
  };
}

/** An order as returned to the status-lookup flow. */
export function orderRecord(overrides: Partial<OrderStatus> = {}): OrderStatus {
  return {
    orderNumber: "ORD-1",
    orderName: "Ada – Custom Dress",
    currentStage: "Sewing/Construction",
    stages: STAGES,
    measurementsLocked: false,
    ...overrides,
  };
}

/** A valid contact-form message. */
export function contactInput(
  overrides: Partial<NewContactRequest> = {},
): NewContactRequest {
  return {
    name: "Grace Hopper",
    email: "grace@example.com",
    message: "Do you ship internationally?",
    ...overrides,
  };
}

/** A valid measurement-change request. Email matches `createOrderInput` by
 * default so the identity gate passes; override it to exercise a mismatch. */
export function measurementChangeInput(
  overrides: Partial<NewMeasurementChangeRequest> = {},
): NewMeasurementChangeRequest {
  return {
    email: "ada@example.com",
    measurementUnit: "inches",
    waist: 29,
    bust: 37,
    hips: 39,
    height: 66,
    bodyGirth: 33,
    ...overrides,
  };
}

/** A valid post-delivery review. Email matches `createOrderInput` by default so
 * the identity gate passes; override it to exercise a mismatch. */
export function reviewInput(
  overrides: Partial<NewReviewRequest> = {},
): NewReviewRequest {
  return {
    email: "ada@example.com",
    rating: 5,
    comment: "Absolutely stunning craftsmanship — it fit like a dream.",
    ...overrides,
  };
}

/** A valid cancellation request. Email matches `createOrderInput` by default so
 * the identity gate passes; override it to exercise a mismatch. Carries a reason
 * by default; drop it to exercise the reason-less path. */
export function cancellationInput(
  overrides: Partial<NewCancellationRequest> = {},
): NewCancellationRequest {
  return {
    email: "ada@example.com",
    reason: "My competition schedule changed.",
    ...overrides,
  };
}

/** A valid back-in-stock request. Whole-variant by default; pass `size` for one band. */
export function notifyInput(
  overrides: Partial<NewNotifyRequest> = {},
): NewNotifyRequest {
  return {
    email: "grace@example.com",
    item: "Bow Fleece Soaker — Black",
    ...overrides,
  };
}

/** A valid newsletter opt-in. Carries a `source` by default; override or drop it
 *  to exercise the source-less path. */
export function newsletterInput(
  overrides: Partial<NewNewsletterRequest> = {},
): NewNewsletterRequest {
  return {
    email: "grace@example.com",
    source: "footer",
    ...overrides,
  };
}

/** A valid return/exchange request. A plain return by default; email matches the
 * shop order in the tests so the identity gate passes — override it to exercise
 * a mismatch, or set `kind: "exchange"` for the exchange path. */
export function returnRequestInput(
  overrides: Partial<NewReturnRequest> = {},
): NewReturnRequest {
  return {
    email: "grace@example.com",
    kind: "return",
    reason: "wrong_size",
    ...overrides,
  };
}

/**
 * A `GET /api/products` response — the shop's live inventory. One in-stock,
 * priced, one-size item by default; pass `products`/`categories` to reshape it
 * (e.g. a sold-out variant, or a dress with a sold-out size band). Used as the
 * mocked HTTP response in the shop/checkout e2e specs.
 */
export function productList(overrides: Partial<ProductList> = {}): ProductList {
  return {
    categories: ["Soaker"],
    products: [
      {
        id: "p1",
        title: "Bow Fleece Soaker",
        category: "Soaker",
        sized: false,
        variants: [
          {
            id: "v1",
            name: "Bow Fleece Soaker",
            available: true,
            price: 22,
            photos: [],
            sizes: [],
          },
        ],
      },
    ],
    ...overrides,
  };
}

/**
 * A `GET /api/colors` response — the studio's intake color palette for the order
 * form's color picker. Two solid colors by default; pass `colors` to reshape it.
 * Used as the mocked HTTP response / hook result in the order-form + picker tests.
 */
export function colorList(overrides: Partial<ColorList> = {}): ColorList {
  return {
    colors: [
      { id: "ivory", name: "Ivory", hex: "#F3ECE2" },
      { id: "emerald", name: "Emerald", hex: "#0B6E4F" },
    ],
    ...overrides,
  };
}

/**
 * The `GET /api/services` catalog — the studio's intake services and, per
 * service, what the order form asks for. Trimmed to two entries that differ in
 * every flag (a commission that needs measurements and colours but no brief; a
 * repair that needs the brief and neither of the others), which is what the
 * order form's branching actually turns on.
 */
export function serviceList(overrides: Partial<ServiceList> = {}): ServiceList {
  return {
    services: [
      {
        id: "bespoke",
        name: "Bespoke Commission",
        summary: "A costume designed and made for you from scratch.",
        measurements: true,
        colors: true,
        detailsRequired: false,
        detailsLabel: "Description",
        detailsHelp: "Tell us about your vision...",
      },
      {
        id: "repairs",
        name: "Repairs & Restoration",
        summary: "Mending and restoring a costume you love.",
        measurements: false,
        colors: false,
        detailsRequired: true,
        detailsLabel: "The piece and what needs repairing",
        detailsHelp: "Tell us what's happened to it...",
      },
    ],
    ...overrides,
  };
}

/**
 * A `GET /api/checkout/session/:id` response — the paid, itemized receipt the
 * shop success page renders. Used as the mocked HTTP response in the checkout
 * e2e spec.
 */
export function checkoutSession(
  overrides: Partial<CheckoutSessionStatus> = {},
): CheckoutSessionStatus {
  return {
    status: "paid",
    email: "grace@example.com",
    currency: "usd",
    lineItems: [{ description: "Bow Fleece Soaker", quantity: 1, amount: 22 }],
    amountSubtotal: 22,
    amountShipping: 8,
    amountTax: 0,
    amountTotal: 30,
    ...overrides,
  };
}
