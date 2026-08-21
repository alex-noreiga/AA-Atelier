import { test, expect } from "./support/test";
import { contactInput, GENERIC_ERROR } from "@workspace/test-fixtures";
import { mockCreateContact } from "./support/mock-api";

const CONTACT = contactInput();

test.describe("Contact form", () => {
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
