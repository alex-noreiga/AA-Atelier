import { test, expect } from "./support/test";
import { GENERIC_ERROR } from "@workspace/test-fixtures";
import { mockCreateDeposit, mockOrderStatus } from "./support/mock-api";

const ORDER = {
  orderNumber: "000002",
  orderName: "Ada – Custom Dress",
  currentStage: "Sewing",
  stages: ["Consultation", "Sewing", "Delivery"],
  depositAmount: 150,
  depositPaid: false,
};

test.describe("Custom-order deposit", () => {
  test("pays the deposit from the status page and redirects to Stripe", async ({
    page,
  }) => {
    await mockOrderStatus(page, { body: ORDER });
    const deposit = await mockCreateDeposit(page, {
      body: { url: "https://checkout.stripe.test/pay/cs_deposit" },
    });
    await page.route("https://checkout.stripe.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<h1 data-testid='stripe-stub'>Stripe Checkout</h1>",
      }),
    );

    await page.goto("/shop/status");
    await page.getByTestId("input-order-number").fill("000002");
    await page.getByTestId("button-lookup").click();

    // The deposit card shows the amount the atelier set.
    await expect(page.getByTestId("deposit-due")).toContainText("$150");

    await page.getByTestId("button-pay-deposit").click();

    await page.waitForURL("**checkout.stripe.test**");
    await expect(page.getByTestId("stripe-stub")).toBeVisible();
    // The deposit was requested for the looked-up order.
    expect(deposit.requestedPaths).toEqual(["/api/orders/000002/deposit"]);
  });

  test("shows a paid confirmation and no button once the deposit is settled", async ({
    page,
  }) => {
    await mockOrderStatus(page, {
      body: {
        ...ORDER,
        depositPaid: true,
        depositSessionId: "cs_test_paid_1",
      },
    });

    await page.goto("/shop/status");
    await page.getByTestId("input-order-number").fill("000002");
    await page.getByTestId("button-lookup").click();

    await expect(page.getByTestId("deposit-paid")).toBeVisible();
    await expect(page.getByTestId("button-pay-deposit")).toHaveCount(0);
    // The paid deposit links to its on-site receipt.
    await expect(page.getByTestId("link-deposit-receipt")).toHaveAttribute(
      "href",
      "/shop/success?session_id=cs_test_paid_1",
    );
  });

  test("shows a destructive toast and stays put when the deposit fails", async ({
    page,
  }) => {
    await mockOrderStatus(page, { body: ORDER });
    await mockCreateDeposit(page, {
      status: 500,
      body: { error: GENERIC_ERROR },
    });

    await page.goto("/shop/status");
    await page.getByTestId("input-order-number").fill("000002");
    await page.getByTestId("button-lookup").click();

    await page.getByTestId("button-pay-deposit").click();

    // `exact` avoids matching sonner's aria-live span, which concatenates the
    // toast title and description into one text node.
    await expect(
      page.getByText("Couldn't start the deposit payment", { exact: true }),
    ).toBeVisible();
    // No redirect; the pay button is still there to retry.
    await expect(page).toHaveURL(/\/shop\/status$/);
    await expect(page.getByTestId("button-pay-deposit")).toBeVisible();
  });
});
