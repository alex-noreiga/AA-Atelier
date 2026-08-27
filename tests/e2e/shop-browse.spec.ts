import { test, expect } from "./support/test";
import { productList } from "@workspace/test-fixtures";
import { mockInstagramFeed, mockProducts } from "./support/mock-api";

// The quick-view dialog in a real browser: opening a card, switching variants,
// and the size selection being cleared across that switch. The category filter
// and the error/empty render states used to live here too, but they duplicated
// shop.test.tsx (which drives the same component tree in jsdom in milliseconds,
// and doesn't have to wait out React Query's ~7s retry backoff for the error
// state). What is left is the one case jsdom does NOT cover. Only /api/products
// is mocked, so the real live-inventory rendering path runs.

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
      sized: false,
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
      sized: true,
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
  // The page's Instagram strip renders nothing on an empty feed, which is what
  // these specs want — they are about the catalogue.
  test.beforeEach(async ({ page }) => {
    await mockInstagramFeed(page);
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
});
