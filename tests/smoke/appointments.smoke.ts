import { test, expect } from "@playwright/test";

// Exercises the real appointment catalog read — `GET /api/appointments/options`
// — which returns the bookable types and booking timezone. We assert at least
// one type option rendered (its id-keyed button), proving the endpoint answered
// with a catalog rather than erroring. Deliberately stops at the Purpose step:
// it does NOT pick a slot or submit a booking, so nothing is written to Google
// Calendar and no confirmation email is sent.

test.describe("Production smoke: appointment options", () => {
  test("the booking form loads bookable appointment types", async ({
    page,
  }) => {
    await page.goto("/appointments");

    // The purpose step is always present; its type buttons only appear once the
    // live options request succeeds (an error renders a "couldn't load" notice
    // instead, and no `type-*` buttons).
    const purpose = page.getByTestId("step-purpose");
    await expect(purpose).toBeVisible();

    const typeOptions = page.locator('[data-testid^="type-"]');
    await expect(typeOptions.first()).toBeVisible({ timeout: 30_000 });
    expect(await typeOptions.count()).toBeGreaterThan(0);
  });
});
