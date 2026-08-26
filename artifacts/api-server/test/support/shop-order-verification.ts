// Stub for `findShopOrderVerification`, the lookup behind every gated shop-order
// action (a return/exchange request, a review of one of its pieces).
//
// A local helper rather than a shared fixture: `ShopOrderVerification` is an
// internal repository shape, not part of the API contract that
// `@workspace/test-fixtures` is typed against.
//
// The defaults describe a plain delivered order with one piece on it, so a test
// about the identity gate says only what it cares about (the email) and a test
// about the delivery or piece gate overrides just that. As with every fixture
// here, this is a stub INPUT — never write an expectation against it.

import type { ShopOrderVerification } from "../../src/lib/notion/shop-orders.repository.js";

export function shopOrderVerification(
  overrides: Partial<ShopOrderVerification> = {},
): ShopOrderVerification {
  return {
    pageId: "page-shop-test",
    email: "grace@example.com",
    status: "Delivered",
    cancelled: false,
    itemIds: ["inv-aurora"],
    ...overrides,
  };
}
