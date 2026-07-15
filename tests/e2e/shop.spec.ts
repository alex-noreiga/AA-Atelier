import { test, expect } from "./support/test";
import { GENERIC_ERROR, productList } from "@workspace/test-fixtures";
import { mockCreateNotify, mockProducts } from "./support/mock-api";

// One sold-out variant (whole item) and one dress sold out in a single size —
// the two ways the shop offers a back-in-stock request. Typed via the shared
// `productList` fixture so the inventory shape can't drift from the contract.
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
          available: false,
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
          name: "Keyhole Dress",
          available: true,
          price: 340,
          photos: [],
          sizes: [
            { name: "Adult XS", available: true },
            { name: "Adult S", available: false },
          ],
        },
      ],
    },
  ],
});

test.describe("Shop back-in-stock dialog", () => {
  test.beforeEach(async ({ page }) => {
    await mockProducts(page, { body: INVENTORY });
  });

  test("takes an email for a sold-out item and confirms in place", async ({
    page,
  }) => {
    const notify = await mockCreateNotify(page, { body: { success: true } });

    await page.goto("/shop");
    await page.getByTestId("cta-notify-v1").first().click();

    await expect(page.getByTestId("notify-dialog")).toBeVisible();
    await page.getByTestId("notify-email").fill("grace@example.com");
    await page.getByTestId("notify-submit").click();

    await expect(page.getByTestId("notify-success")).toBeVisible();
    // The whole variant is sold out, so no size is attached.
    expect(notify.requests).toEqual([
      { email: "grace@example.com", item: "Bow Fleece Soaker" },
    ]);
  });

  test("attaches the exact size when a sold-out size band is clicked", async ({
    page,
  }) => {
    const notify = await mockCreateNotify(page, { body: { success: true } });

    await page.goto("/shop");
    await page.getByTestId("size-notify-v2-adult-s").first().click();

    await page.getByTestId("notify-email").fill("grace@example.com");
    await page.getByTestId("notify-submit").click();

    await expect(page.getByTestId("notify-success")).toBeVisible();
    expect(notify.requests).toEqual([
      { email: "grace@example.com", item: "Keyhole Dress", size: "Adult S" },
    ]);
  });

  test("shows a destructive toast when the API rejects the request", async ({
    page,
  }) => {
    await mockCreateNotify(page, {
      status: 500,
      body: { error: GENERIC_ERROR },
    });

    await page.goto("/shop");
    await page.getByTestId("cta-notify-v1").first().click();
    await page.getByTestId("notify-email").fill("grace@example.com");
    await page.getByTestId("notify-submit").click();

    await expect(page.getByText("Couldn't save your request")).toBeVisible();
    await expect(page.getByTestId("notify-success")).toHaveCount(0);
  });
});
