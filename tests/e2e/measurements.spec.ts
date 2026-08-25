import { test, expect } from "./support/test";
import { orderRecord } from "@workspace/test-fixtures";
import type { Page } from "@playwright/test";
import {
  mockMeasurementChange,
  mockUpdateMeasurements,
  mockOrderStatus,
} from "./support/mock-api";

// The measurement flow lives behind an order lookup: the customer finds their
// order on the status page, then opens the dialog from the success view. What
// only a browser can prove is the PAGE WIRING — that the dialog is handed the
// order number the lookup found, and that each mode reaches the endpoint it is
// supposed to (one edits the order, the other files a request) — so those get a
// pass each, plus the toast path (rendered outside the dialog's own tree). The
// field validation, the outcome copy, and the inline 403/409 states are the
// dialog's own behavior and are covered in
// web-app/test/measurements-dialog.test.tsx, in milliseconds.

/** Look up the default order and open the measurements dialog. */
async function openDialog(page: Page): Promise<void> {
  await mockOrderStatus(page, { body: orderRecord({ orderNumber: "ORD-1" }) });
  await page.goto("/track");
  await page.getByTestId("input-order-number").fill("ORD-1");
  await page.getByTestId("button-lookup").click();
  await expect(page.getByTestId("status-success")).toBeVisible();

  await page.getByTestId("button-update-measurements").click();
  await expect(page.getByTestId("measurements-dialog")).toBeVisible();
}

test.describe("In-place measurement editing", () => {
  test("writes the measurements against the looked-up order", async ({
    page,
  }) => {
    const update = await mockUpdateMeasurements(page, {
      body: { outcome: "applied" },
    });
    const filed = await mockMeasurementChange(page, {
      body: { received: true },
    });

    await openDialog(page);

    await page.getByTestId("measurements-email").fill("ada@example.com");
    await page.getByTestId("measurements-waist").fill("29");
    await page.getByTestId("measurements-bust").fill("37");
    await page.getByTestId("measurements-hips").fill("39");
    await page.getByTestId("measurements-height").fill("66");
    await page.getByTestId("measurements-bodyGirth").fill("33");
    await page.getByTestId("measurements-submit").click();

    await expect(page.getByTestId("measurements-success")).toBeVisible();
    await expect(page.getByTestId("measurements-success")).toContainText(
      "now on order",
    );

    // The edit went to the looked-up order and carried the mapped numbers —
    // measurements as numbers, unit included.
    expect(update.requestedPaths).toEqual(["/api/orders/ORD-1/measurements"]);
    expect(update.requests).toEqual([
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
    // Entering values edits the order; nothing was filed for a human.
    expect(filed.requestedPaths).toEqual([]);
  });

  test("reports an edit the server could only file, rather than claiming a save", async ({
    page,
  }) => {
    await mockUpdateMeasurements(page, { body: { outcome: "filed" } });

    await openDialog(page);

    await page.getByTestId("measurements-email").fill("ada@example.com");
    await page.getByTestId("measurements-waist").fill("29");
    await page.getByTestId("measurements-bust").fill("37");
    await page.getByTestId("measurements-hips").fill("39");
    await page.getByTestId("measurements-height").fill("66");
    await page.getByTestId("measurements-bodyGirth").fill("33");
    await page.getByTestId("measurements-submit").click();

    await expect(page.getByTestId("measurements-success")).toContainText(
      "passed your measurements to the atelier",
    );
  });

  test("files a change request when asking to be re-measured at a fitting", async ({
    page,
  }) => {
    const update = await mockUpdateMeasurements(page, {
      body: { outcome: "applied" },
    });
    const filed = await mockMeasurementChange(page, {
      body: { received: true },
    });

    await openDialog(page);

    await page.getByTestId("measurements-email").fill("ada@example.com");
    await page.getByTestId("measurements-mode-appointment").click();
    await page.getByTestId("measurements-submit").click();

    await expect(page.getByTestId("measurements-success")).toContainText(
      "schedule a fitting",
    );
    // Asking to be re-measured is a request for a service only a person can
    // perform, so it must never take the in-place write path.
    expect(filed.requestedPaths).toEqual([
      "/api/orders/ORD-1/measurement-change-requests",
    ]);
    expect(update.requestedPaths).toEqual([]);
  });

  test("raises a destructive toast on an unexpected server error", async ({
    page,
  }) => {
    await mockMeasurementChange(page, {
      status: 500,
      body: { error: "Something went wrong. Please try again later." },
    });

    await openDialog(page);

    await page.getByTestId("measurements-email").fill("ada@example.com");
    await page.getByTestId("measurements-mode-appointment").click();
    await page.getByTestId("measurements-submit").click();

    // 500 is unexpected — a toast, not the inline form error.
    await expect(
      page.getByText("Couldn't update your measurements", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("measurements-error")).toHaveCount(0);
    await expect(page.getByTestId("measurements-success")).toHaveCount(0);
  });
});
