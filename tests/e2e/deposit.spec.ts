import { test, expect } from "./support/test";
import { GENERIC_ERROR } from "@workspace/test-fixtures";
import { mockCreatePayment, mockOrderStatus } from "./support/mock-api";

const ORDER = {
  orderNumber: "000002",
  orderName: "Ada – Custom Dress",
  currentStage: "Sewing",
  stages: ["Consultation", "Sewing", "Delivery"],
  measurementsLocked: false,
  deposits: [
    {
      stage: "first_deposit",
      label: "First deposit",
      amount: 150,
      paid: false,
    },
  ],
};

test.describe("Custom-order deposit", () => {
  test("pays the first deposit from the status page and redirects to Stripe", async ({
    page,
  }) => {
    await mockOrderStatus(page, { body: ORDER });
    const payment = await mockCreatePayment(page, {
      body: { url: "https://checkout.stripe.test/pay/cs_deposit" },
    });
    await page.route("https://checkout.stripe.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<h1 data-testid='stripe-stub'>Stripe Checkout</h1>",
      }),
    );

    await page.goto("/track");
    await page.getByTestId("input-order-number").fill("000002");
    await page.getByTestId("button-lookup").click();

    // The deposit card shows the amount the atelier set.
    await expect(page.getByTestId("deposit-due-first_deposit")).toContainText(
      "$150",
    );

    await page.getByTestId("button-pay-first_deposit").click();

    await page.waitForURL("**checkout.stripe.test**");
    await expect(page.getByTestId("stripe-stub")).toBeVisible();
    // The first-deposit payment was requested for the looked-up order.
    expect(payment.requestedPaths).toEqual([
      "/api/orders/000002/payments/first_deposit",
    ]);
  });

  test("shows a paid confirmation and no button once the deposit is settled", async ({
    page,
  }) => {
    await mockOrderStatus(page, {
      body: {
        ...ORDER,
        deposits: [
          {
            stage: "first_deposit",
            label: "First deposit",
            amount: 150,
            paid: true,
            sessionId: "cs_test_paid_1",
          },
        ],
      },
    });

    await page.goto("/track");
    await page.getByTestId("input-order-number").fill("000002");
    await page.getByTestId("button-lookup").click();

    await expect(page.getByTestId("deposit-paid-first_deposit")).toBeVisible();
    await expect(page.getByTestId("button-pay-first_deposit")).toHaveCount(0);
    // The paid deposit links to its on-site receipt.
    await expect(
      page.getByTestId("link-deposit-receipt-first_deposit"),
    ).toHaveAttribute("href", "/shop/success?session_id=cs_test_paid_1");
  });

  test("shows a destructive toast and stays put when the deposit fails", async ({
    page,
  }) => {
    await mockOrderStatus(page, { body: ORDER });
    await mockCreatePayment(page, {
      status: 500,
      body: { error: GENERIC_ERROR },
    });

    await page.goto("/track");
    await page.getByTestId("input-order-number").fill("000002");
    await page.getByTestId("button-lookup").click();

    await page.getByTestId("button-pay-first_deposit").click();

    // `exact` avoids matching sonner's aria-live span, which concatenates the
    // toast title and description into one text node.
    await expect(
      page.getByText("Couldn't start the deposit payment", { exact: true }),
    ).toBeVisible();
    // No redirect; the pay button is still there to retry.
    await expect(page).toHaveURL(/\/track$/);
    await expect(page.getByTestId("button-pay-first_deposit")).toBeVisible();
  });
});
