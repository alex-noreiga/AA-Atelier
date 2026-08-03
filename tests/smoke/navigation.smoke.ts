import { test, expect } from "@playwright/test";

// The SPA loads and its routes render — the marketing shell and every primary
// destination reachable from the global navbar. This catches a broken build, a
// bad asset deploy, or a route that white-screens, without touching any
// write path. Pure navigation + static-render assertions.

test.describe("Production smoke: site navigation", () => {
  test("landing page renders with the global navbar", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("link-brand")).toBeVisible();
    await expect(page.getByTestId("nav-shop")).toBeVisible();
    // A home CTA proves the page body rendered, not just the shared chrome.
    await expect(page.getByTestId("cta-place-order")).toBeVisible();
  });

  // Each info/route page and a stable element that only exists once its own
  // component has mounted (so the assertion fails if the route white-screens).
  // Pages with a testid assert on it; the static legal pages (which share a
  // testid-less shell) assert on their unique <h1> heading instead.
  const routes: {
    path: string;
    name: string;
    testId?: string;
    heading?: string;
  }[] = [
    { path: "/about", testId: "story-section", name: "About" },
    { path: "/services", testId: "cta-begin-commission", name: "Services" },
    { path: "/contact", testId: "submit-contact", name: "Contact" },
    { path: "/order", testId: "submit-order", name: "Order form" },
    { path: "/appointments", testId: "step-purpose", name: "Appointments" },
    // Legal / policy pages (consent + terms live here) — heading-based, since
    // the shared LegalPage shell carries no testid.
    { path: "/privacy", testId: "manage-cookie-preferences", name: "Privacy" },
    { path: "/terms", heading: "Terms of Service", name: "Terms" },
    {
      path: "/shipping-returns",
      heading: "Shipping & Returns",
      name: "Shipping & Returns",
    },
    // Account portal sign-in shell (the magic-link request form) — the form
    // renders read-only; we never submit it, so no email is sent.
    { path: "/account/login", testId: "input-email", name: "Account sign-in" },
  ];

  for (const { path, name, testId, heading } of routes) {
    test(`${name} (${path}) renders`, async ({ page }) => {
      await page.goto(path);
      const target = testId
        ? page.getByTestId(testId)
        : page.getByRole("heading", { name: heading!, level: 1 });
      await expect(target).toBeVisible();
    });
  }

  test("navbar routes from the landing page to the shop", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-shop").click();
    await expect(page).toHaveURL(/\/shop$/);
  });
});
