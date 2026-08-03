import { test, expect } from "@playwright/test";

// The one smoke that asserts a SUCCESSFUL data render, not just a 404/no-error
// path. Every other data spec proves "the endpoint didn't error"; none proves a
// customer can actually SEE their order — so a regression that breaks the
// success timeline render (the real payoff) would sail through green.
//
// Gated on SMOKE_KNOWN_ORDER_NUMBER: point it at a permanent sentinel order the
// atelier never deletes (a custom `ORD-…` or a shop `SHP-…` — the unified
// lookup handles both). Read-only: it looks the order up and asserts the
// success card renders. Unset ⇒ the test is SKIPPED, so nothing breaks until
// the sentinel exists.

const KNOWN_ORDER = process.env.SMOKE_KNOWN_ORDER_NUMBER;

test.describe("Production smoke: known-good order renders", () => {
  test.skip(
    !KNOWN_ORDER,
    "Set SMOKE_KNOWN_ORDER_NUMBER to a permanent sentinel order to enable.",
  );

  test("a known order resolves to the success timeline", async ({ page }) => {
    await page.goto("/track");

    await page.getByTestId("input-order-number").fill(KNOWN_ORDER!);
    await page.getByTestId("button-lookup").click();

    // The success card renders the live stage timeline — proving the full
    // read + map + render path, not merely that Notion answered.
    await expect(page.getByTestId("status-success")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("status-error")).toBeHidden();
  });
});
