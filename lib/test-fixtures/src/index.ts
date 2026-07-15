// Shared domain fixtures for the test suites (api-server Vitest, order-status
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
  NewContactRequest,
  NewMeasurementChangeRequest,
  NewNotifyRequest,
  NewOrderRequest,
  OrderStatus,
  ProductList,
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
