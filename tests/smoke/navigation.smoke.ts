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
  const routes: { path: string; testId: string; name: string }[] = [
    { path: "/about", testId: "story-section", name: "About" },
    { path: "/services", testId: "cta-begin-commission", name: "Services" },
    { path: "/contact", testId: "submit-contact", name: "Contact" },
    { path: "/order", testId: "submit-order", name: "Order form" },
    { path: "/appointments", testId: "step-purpose", name: "Appointments" },
  ];

  for (const { path, testId, name } of routes) {
    test(`${name} (${path}) renders`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByTestId(testId)).toBeVisible();
    });
  }

  test("navbar routes from the landing page to the shop", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-shop").click();
    await expect(page).toHaveURL(/\/shop$/);
  });
});
