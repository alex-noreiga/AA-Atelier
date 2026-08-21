import { test, expect } from "@playwright/test";

// The SPA loads and its routes render — the marketing shell and every primary
// destination reachable from the global navbar. This catches a broken build, a
// bad asset deploy, or a route that white-screens, without touching any
// write path. Pure navigation + static-render assertions.

test.describe("Production smoke: site navigation", () => {
  test("landing page renders with the global navbar", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("link-brand")).toBeVisible();
    // The navbar swaps to a Sheet (hamburger) menu below the `md` breakpoint,
    // where the desktop links live in a `hidden md:flex` container. So the
    // stable nav-chrome element differs by viewport: the menu button on mobile,
    // the Shop link on desktop.
    if (isMobile) {
      await expect(page.getByTestId("button-menu")).toBeVisible();
    } else {
      await expect(page.getByTestId("nav-shop")).toBeVisible();
    }
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
    // The intake is a THREE-step flow (PR #194, 2026-08-20): "Your details" ->
    // "Your piece" -> "Timeline". `submit-order` lives on the last step, so it
    // does not exist on load — asserting it here turned the monitor red the
    // morning after that shipped, with production perfectly healthy. Assert the
    // step-1 CTA instead: it is present on load and only renders once the form
    // itself has mounted, so a white-screened route still fails.
    { path: "/order", testId: "continue-to-design", name: "Order form" },
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
    // Account portal sign-in shell (the account sign-in form) — the form
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

  test("navbar routes from the landing page to the shop", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/");
    // On mobile the Shop link lives inside the Sheet menu (open it first, then
    // click the mobile link); on desktop it's a top-level navbar link. This is
    // the real navigation path a visitor takes on each viewport.
    if (isMobile) {
      await page.getByTestId("button-menu").click();
      await page.getByTestId("nav-mobile-shop").click();
    } else {
      await page.getByTestId("nav-shop").click();
    }
    await expect(page).toHaveURL(/\/shop$/);
  });
});
