import { test, expect } from "./support/test";
import { contactInput, GENERIC_ERROR } from "@workspace/test-fixtures";
import { mockCreateContact } from "./support/mock-api";

const CONTACT = contactInput();

test.describe("Contact form", () => {
  test("submits a message and shows the confirmation screen (API mocked)", async ({
    page,
  }) => {
    await mockCreateContact(page, { body: { success: true } });

    await page.goto("/contact");
    await expect(
      page.getByRole("heading", { name: "Contact Us" }),
    ).toBeVisible();

    await page.locator("#name").fill(CONTACT.name);
    await page.locator("#email").fill(CONTACT.email);
    await page.locator("#message").fill(CONTACT.message);
    await page.getByRole("button", { name: "Send Message" }).click();

    await expect(
      page.getByRole("heading", { name: "Message Sent" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Back to home/i }),
    ).toBeVisible();
  });

  test("blocks submission and shows validation errors for an empty form", async ({
    page,
  }) => {
    let apiCalled = false;
    await page.route("**/api/contact", (route) => {
      apiCalled = true;
      return route.fallback();
    });

    await page.goto("/contact");
    await page.getByRole("button", { name: "Send Message" }).click();

    await expect(page.getByText("Your name is required")).toBeVisible();
    await expect(page.getByText("Please enter a message")).toBeVisible();
    expect(apiCalled).toBe(false);
  });

  test("shows a destructive toast when the API rejects the message", async ({
    page,
  }) => {
    await mockCreateContact(page, {
      status: 500,
      body: { error: GENERIC_ERROR },
    });

    await page.goto("/contact");
    await page.locator("#name").fill(CONTACT.name);
    await page.locator("#email").fill(CONTACT.email);
    await page.locator("#message").fill("Hello there");
    await page.getByRole("button", { name: "Send Message" }).click();

    // `exact` avoids matching sonner's aria-live announcement span, which
    // concatenates the toast title and description into one text node.
    await expect(
      page.getByText("Message failed to send", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Message Sent" }),
    ).toHaveCount(0);
  });
});
