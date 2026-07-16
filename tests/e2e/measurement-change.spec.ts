import { test, expect } from "./support/test";
import { orderRecord } from "@workspace/test-fixtures";
import type { Page } from "@playwright/test";
import {
  mockMeasurementChange,
  mockOrderStatus,
} from "./support/mock-api";

// The "request a measurement change" flow lives behind an order lookup: the
// customer finds their order on the status page, then opens the dialog from the
// success view. These specs drive the whole thing in the browser — the lookup,
// the dialog, the submit mapping, and each server outcome the dialog handles
// differently (403/409 inline vs. an unexpected 500 toast). Only the endpoint is
// mocked, so the real page wiring (that the dialog is handed the looked-up order
// number) is exercised.

/** Look up the default order and open the measurement-change dialog. */
async function openDialog(page: Page): Promise<void> {
  await mockOrderStatus(page, { body: orderRecord({ orderNumber: "ORD-1" }) });
  await page.goto("/shop/status");
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

  test("asks to be re-measured at a fitting instead of entering values", async ({
    page,
  }) => {
    const request = await mockMeasurementChange(page, {
      body: { success: true },
    });

    await openDialog(page);

    await page.getByTestId("measurement-change-email").fill("ada@example.com");
    // Switch to the re-measure flow — the measurement inputs disappear.
    await page.getByTestId("measurement-change-mode-appointment").click();
    await expect(
      page.getByTestId("measurement-change-waist"),
    ).toHaveCount(0);
    await page.getByTestId("measurement-change-submit").click();

    await expect(page.getByTestId("measurement-change-success")).toBeVisible();
    await expect(page.getByTestId("measurement-change-success")).toContainText(
      "schedule a fitting",
    );

    // Appointment mode sends only the flag — no measurements, no unit.
    expect(request.requests).toEqual([
      { email: "ada@example.com", measurementAppointment: true },
    ]);
  });

  test("shows the field errors and does not submit when measurements are missing", async ({
    page,
  }) => {
    // No mock: the guard fixture will fail the run if the form submits an
    // /api call, which is exactly what must NOT happen here.
    await openDialog(page);

    await page.getByTestId("measurement-change-email").fill("ada@example.com");
    // Leave every measurement blank in "self" mode.
    await page.getByTestId("measurement-change-submit").click();

    await expect(page.getByText("Required").first()).toBeVisible();
    await expect(page.getByTestId("measurement-change-success")).toHaveCount(0);
  });

  test("surfaces a 403 email mismatch inline in the dialog", async ({
    page,
  }) => {
    await mockMeasurementChange(page, {
      status: 403,
      body: { error: "That email doesn't match the one on this order." },
    });

    await openDialog(page);

    await page
      .getByTestId("measurement-change-email")
      .fill("wrong@example.com");
    await page.getByTestId("measurement-change-mode-appointment").click();
    await page.getByTestId("measurement-change-submit").click();

    // 403 is an expected, actionable outcome — inline error, dialog stays open.
    await expect(page.getByTestId("measurement-change-error")).toContainText(
      "doesn't match",
    );
    await expect(page.getByTestId("measurement-change-success")).toHaveCount(0);
    await expect(page.getByTestId("measurement-change-dialog")).toBeVisible();
  });

  test("surfaces a 409 production lock inline in the dialog", async ({
    page,
  }) => {
    await mockMeasurementChange(page, {
      status: 409,
      body: {
        error: "This order is already in production; measurements are locked.",
      },
    });

    await openDialog(page);

    await page.getByTestId("measurement-change-email").fill("ada@example.com");
    await page.getByTestId("measurement-change-mode-appointment").click();
    await page.getByTestId("measurement-change-submit").click();

    await expect(page.getByTestId("measurement-change-error")).toContainText(
      "in production",
    );
    await expect(page.getByTestId("measurement-change-success")).toHaveCount(0);
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
