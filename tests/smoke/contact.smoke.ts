import { test, expect } from "@playwright/test";

// The contact form renders and its client-side validation fires. We submit it
// EMPTY on purpose: react-hook-form + zod block the submit and surface the
// required-field errors, so no `POST /api/contact` is sent — this stays
// non-destructive (no real message written to Notion, no acknowledgement email)
// while still proving the form and its validation shipped intact.

test.describe("Production smoke: contact form", () => {
  test("empty submit is blocked by client-side validation", async ({
    page,
  }) => {
    await page.goto("/contact");

    const submit = page.getByTestId("submit-contact");
    await expect(submit).toBeVisible();
    await submit.click();

    // zod's required-field message renders and we stay on /contact — the
    // submit never left the browser.
    await expect(page.getByText("Your name is required")).toBeVisible();
    await expect(page).toHaveURL(/\/contact$/);
  });
});
