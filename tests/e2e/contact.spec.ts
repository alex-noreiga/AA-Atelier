import { test, expect } from "@playwright/test";
import { mockCreateContact } from "./support/mock-api";

test.describe("Contact form", () => {
  test("submits a message and shows the confirmation screen (API mocked)", async ({
    page,
  }) => {
    await mockCreateContact(page, { body: { success: true } });

    await page.goto("/contact");
    await expect(
      page.getByRole("heading", { name: "Contact Us" }),
    ).toBeVisible();

    await page.locator("#name").fill("Grace Hopper");
    await page.locator("#email").fill("grace@example.com");
    await page.locator("#message").fill("Do you ship internationally?");
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
      body: { error: "Something went wrong. Please try again later." },
    });

    await page.goto("/contact");
    await page.locator("#name").fill("Grace Hopper");
    await page.locator("#email").fill("grace@example.com");
    await page.locator("#message").fill("Hello there");
    await page.getByRole("button", { name: "Send Message" }).click();

    await expect(page.getByText("Message failed to send")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Message Sent" }),
    ).toHaveCount(0);
  });
});
