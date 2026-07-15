import { test, expect } from "./support/test";
import {
  checkoutSession,
  GENERIC_ERROR,
  productList,
} from "@workspace/test-fixtures";
import {
  mockCreateCheckout,
  mockGetCheckoutSession,
  mockProducts,
} from "./support/mock-api";

test.describe("Shop checkout", () => {
  // One in-stock, priced, one-size item — the simplest thing the shop can sell.
  test.beforeEach(async ({ page }) => {
    await mockProducts(page, { body: productList() });
  });

  test("adds an item and redirects to the Stripe payment page with the right line items", async ({
    page,
  }) => {
    // The server returns Stripe's hosted-checkout URL; stub that external page
    // so the redirect is deterministic (this mirrors production, where the app
    // does window.location = the Stripe URL).
    const checkout = await mockCreateCheckout(page, {
      body: { url: "https://checkout.stripe.test/pay/cs_test_e2e" },
    });
    await page.route("https://checkout.stripe.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<h1 data-testid='stripe-stub'>Stripe Checkout</h1>",
      }),
    );

    await page.goto("/shop");

    // Add to cart — the navbar cart count reflects it.
    await page.getByTestId("add-to-cart-v1").first().click();
    await expect(page.getByTestId("cart-count")).toHaveText("1");

    // Open the drawer and check out.
    await page.getByTestId("cart-button").first().click();
    await expect(page.getByTestId("cart-subtotal")).toContainText("$22");
    await page.getByTestId("cart-checkout").click();

    // Redirected to Stripe's (stubbed) hosted checkout.
    await page.waitForURL("**checkout.stripe.test**");
    await expect(page.getByTestId("stripe-stub")).toBeVisible();

    // The server received exactly the ids/quantities — never a price.
    expect(checkout.requests).toEqual([
      { items: [{ variantId: "v1", quantity: 1 }] },
    ]);
  });

  test("confirms the order and empties the cart on the success page", async ({
    page,
  }) => {
    await mockGetCheckoutSession(page, { body: checkoutSession() });
    // Seed a cart the way a mid-purchase buyer would have one, so we can prove
    // the success page clears it. Seeding via storage keeps this to a single
    // navigation (Stripe → the app), matching how the customer actually arrives.
    await page.addInitScript(() => {
      // Runs in the browser; cast around the Node-only types in this package.
      (
        globalThis as {
          localStorage: { setItem(key: string, value: string): void };
        }
      ).localStorage.setItem(
        "aa-cart",
        JSON.stringify([
          {
            variantId: "v1",
            name: "Bow Fleece Soaker",
            price: 22,
            quantity: 1,
          },
        ]),
      );
    });

    await page.goto("/shop/success?session_id=cs_test_e2e", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("shop-success")).toContainText(
      "grace@example.com",
    );
    // The itemized receipt renders, with shipping and the grand total.
    await expect(page.getByTestId("receipt")).toContainText(
      "Bow Fleece Soaker",
    );
    await expect(page.getByTestId("receipt")).toContainText("Shipping");
    await expect(page.getByTestId("receipt-total")).toHaveText("$30");
    // The cart is cleared on arrival, so the count badge is gone.
    await expect(page.getByTestId("cart-count")).toHaveCount(0);
  });

  test("shows a destructive toast and keeps the cart when checkout fails", async ({
    page,
  }) => {
    await mockCreateCheckout(page, {
      status: 500,
      body: { error: GENERIC_ERROR },
    });

    await page.goto("/shop");
    await page.getByTestId("add-to-cart-v1").first().click();
    await page.getByTestId("cart-button").first().click();
    await page.getByTestId("cart-checkout").click();

    // `exact` avoids matching sonner's aria-live span, which concatenates the
    // toast title and description into one text node.
    await expect(
      page.getByText("Couldn't start checkout", { exact: true }),
    ).toBeVisible();
    // No redirect happened, and the cart still holds the item.
    await expect(page).toHaveURL(/\/shop$/);
    await expect(page.getByTestId("cart-count")).toHaveText("1");
  });
});
