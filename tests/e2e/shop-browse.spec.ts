import { test, expect } from "./support/test";
import { productList } from "@workspace/test-fixtures";
import { mockProducts } from "./support/mock-api";

// Browsing the catalogue itself — the category filter, the quick-view dialog,
// switching variants, and the non-happy render states. The existing shop specs
// cover the back-in-stock dialog (shop.spec) and add-to-cart -> checkout
// (checkout.spec); none of them exercise filtering, quick-view, or the
// error/empty chrome, which is what these add. Only /api/products is mocked, so
// the real live-inventory rendering path runs.

// A two-category catalogue so the filter chips render (they only appear once
// there's more than one real category): a one-size soaker and a two-variant,
// sized dress.
const INVENTORY = productList({
  categories: ["Soaker", "Dress"],
  products: [
    {
      id: "p1",
      title: "Bow Fleece Soaker",
      category: "Soaker",
      variants: [
        {
          id: "v1",
          name: "Bow Fleece Soaker",
          available: true,
          price: 22,
          photos: [],
          sizes: [],
        },
      ],
    },
    {
      id: "p2",
      title: "Keyhole Dress",
      category: "Dress",
      variants: [
        {
          id: "v2",
          name: "Keyhole Dress — Black",
          available: true,
          price: 340,
          photos: [],
          sizes: [
            { name: "Adult XS", available: true },
            { name: "Adult S", available: true },
          ],
        },
        {
          id: "v3",
          name: "Keyhole Dress — Ivory",
          available: true,
          price: 360,
          photos: [],
          sizes: [{ name: "Adult XS", available: true }],
        },
      ],
    },
  ],
});

test.describe("Shop browsing", () => {
  test("filters the grid by category and back to All", async ({ page }) => {
    await mockProducts(page, { body: INVENTORY });
    await page.goto("/shop");

    // Both products show under the default "All" filter.
    await expect(page.getByTestId("product-p1")).toBeVisible();
    await expect(page.getByTestId("product-p2")).toBeVisible();

    // Filter to Dress — the soaker drops out.
    await page.getByTestId("filter-dress").click();
    await expect(page.getByTestId("product-p1")).toHaveCount(0);
    await expect(page.getByTestId("product-p2")).toBeVisible();

    // Filter to Soaker — the dress drops out.
    await page.getByTestId("filter-soaker").click();
    await expect(page.getByTestId("product-p2")).toHaveCount(0);
    await expect(page.getByTestId("product-p1")).toBeVisible();

    // Back to All — both return.
    await page.getByTestId("filter-all").click();
    await expect(page.getByTestId("product-p1")).toBeVisible();
    await expect(page.getByTestId("product-p2")).toBeVisible();
  });

  test("opens the quick-view dialog and switches variants, clearing the chosen size", async ({
    page,
  }) => {
    await mockProducts(page, { body: INVENTORY });
    await page.goto("/shop");

    await page.getByTestId("product-view-p2").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Keyhole Dress" }),
    ).toBeVisible();
    await expect(dialog.getByText("Dress").first()).toBeVisible();
    await expect(dialog.getByText("$340")).toBeVisible();

    // Sized item — Add to cart is disabled until a size is chosen.
    await expect(dialog.getByTestId("add-to-cart-v2")).toBeDisabled();
    await dialog.getByTestId("size-v2-adult-xs").click();
    await expect(dialog.getByTestId("size-v2-adult-xs")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(dialog.getByTestId("add-to-cart-v2")).toBeEnabled();

    // Switch to the Ivory variant: the price updates and the size selection is
    // cleared, so its Add-to-cart is disabled again (a size stocked in one
    // variant may be absent in another).
    await dialog.getByTestId("variant-v3").click();
    await expect(dialog.getByText("$360")).toBeVisible();
    await expect(dialog.getByTestId("size-v2-adult-xs")).toHaveCount(0);
    await expect(dialog.getByTestId("add-to-cart-v3")).toBeDisabled();
  });

  test("shows the error state but keeps the page chrome when inventory fails to load", async ({
    page,
  }) => {
    await mockProducts(page, { status: 500, body: { error: "boom" } });
    await page.goto("/shop");

    // useGetProducts uses React Query's default retry (3 attempts with
    // exponential backoff, ~7s), so allow more than the default assertion wait
    // for the error state to settle.
    await expect(page.getByTestId("shop-error")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("product-p1")).toHaveCount(0);
    // The closing commission CTA still renders on the failure path.
    await expect(page.getByTestId("cta-commission")).toBeVisible();
  });

  test("shows the restocking message when the catalogue is empty", async ({
    page,
  }) => {
    await mockProducts(page, {
      body: productList({ categories: [], products: [] }),
    });
    await page.goto("/shop");

    await expect(page.getByTestId("shop-empty")).toBeVisible();
    // With no real categories the filter chips don't render.
    await expect(page.getByTestId("filter-all")).toHaveCount(0);
    await expect(page.getByTestId("cta-commission")).toBeVisible();
  });
});
