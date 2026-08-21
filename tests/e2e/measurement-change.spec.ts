import { test, expect } from "./support/test";
import { orderRecord } from "@workspace/test-fixtures";
import type { Page } from "@playwright/test";
import { mockMeasurementChange, mockOrderStatus } from "./support/mock-api";

// The "request a measurement change" flow lives behind an order lookup: the
// customer finds their order on the status page, then opens the dialog from the
// success view. What only a browser can prove is the PAGE WIRING — that the
// dialog is handed the order number the lookup found — so one happy path covers
// that, plus the toast path (rendered outside the dialog's own tree). The
// appointment mode, the field-validation errors, and the inline 403/409 states
// are the dialog's own behavior and are covered in
// web-app/test/measurement-change-dialog.test.tsx, in milliseconds.

/** Look up the default order and open the measurement-change dialog. */
async function openDialog(page: Page): Promise<void> {
  await mockOrderStatus(page, { body: orderRecord({ orderNumber: "ORD-1" }) });
  await page.goto("/track");
  await page.getByTestId("input-order-number").fill("ORD-1");
  await page.getByTestId("button-lookup").click();
  await expect(page.getByTestId("status-success")).toBeVisible();

  await page.getByTestId("button-request-measurement-change").click();
  await expect(page.getByTestId("measurement-change-dialog")).toBeVisible();
}

test.describe("Measurement change request", () => {
  test("submits updated measurements against the looked-up order", async ({
    page,
  }) => {
    const request = await mockMeasurementChange(page, {
      body: { success: true },
    });

    await openDialog(page);

    await page.getByTestId("measurement-change-email").fill("ada@example.com");
    await page.getByTestId("measurement-change-waist").fill("29");
    await page.getByTestId("measurement-change-bust").fill("37");
    await page.getByTestId("measurement-change-hips").fill("39");
    await page.getByTestId("measurement-change-height").fill("66");
    await page.getByTestId("measurement-change-bodyGirth").fill("33");
    await page.getByTestId("measurement-change-submit").click();

    await expect(page.getByTestId("measurement-change-success")).toBeVisible();
    await expect(page.getByTestId("measurement-change-success")).toContainText(
      "passed your updated measurements",
    );

    // The request went to the looked-up order and carried the mapped numbers —
    // measurements as numbers, unit included, no re-measure flag.
    expect(request.requestedPaths).toEqual([
      "/api/orders/ORD-1/measurement-change-requests",
    ]);
    expect(request.requests).toEqual([
      {
        email: "ada@example.com",
        measurementUnit: "inches",
        waist: 29,
        bust: 37,
        hips: 39,
        height: 66,
        bodyGirth: 33,
      },
    ]);
  });

  test("raises a destructive toast on an unexpected server error", async ({
    page,
  }) => {
    await mockMeasurementChange(page, {
      status: 500,
      body: { error: "Something went wrong. Please try again later." },
    });

    await openDialog(page);

    await page.getByTestId("measurement-change-email").fill("ada@example.com");
    await page.getByTestId("measurement-change-mode-appointment").click();
    await page.getByTestId("measurement-change-submit").click();

    // 500 is unexpected — a toast, not the inline form error.
    await expect(
      page.getByText("Couldn't submit your request", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("measurement-change-error")).toHaveCount(0);
    await expect(page.getByTestId("measurement-change-success")).toHaveCount(0);
  });
});
