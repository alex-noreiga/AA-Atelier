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
  NewContactRequest,
  NewMeasurementChangeRequest,
  NewNotifyRequest,
  NewOrderRequest,
  NewReviewRequest,
  OrderStatus,
  Review,
} from "@workspace/api-zod";

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

/** A valid review submission. Email matches `createOrderInput` by default so the
 * identity gate passes; override it to exercise a mismatch. */
export function reviewInput(
  overrides: Partial<NewReviewRequest> = {},
): NewReviewRequest {
  return {
    orderNumber: "ORD-1",
    email: "ada@example.com",
    name: "Ada Lovelace",
    rating: 5,
    body: "The dress was exquisite and fit perfectly.",
    ...overrides,
  };
}

/** A published review as returned to the display flow. */
export function reviewRecord(overrides: Partial<Review> = {}): Review {
  return {
    id: "review-1",
    name: "Ada Lovelace",
    rating: 5,
    body: "The dress was exquisite and fit perfectly.",
    date: "2026-01-15T12:00:00.000Z",
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
