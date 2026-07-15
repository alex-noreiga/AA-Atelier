import { test, expect } from "@playwright/test";
import {
  mockAppointmentOptions,
  mockAppointmentAvailability,
  mockCreateAppointment,
} from "./support/mock-api";

// The API is fully mocked, so slot instants are arbitrary; UTC keeps the
// rendered date/time predictable regardless of the runner's locale.
const SLOT_ISO = "2026-12-21T15:00:00.000Z";

const OPTIONS = {
  timezone: "UTC",
  types: [
    {
      id: "consultation",
      name: "Consultation",
      durationMinutes: 30,
      description: "Talk through ideas for a new custom piece.",
      staff: ["Alexandra", "Alayna"],
      locations: ["in-person", "virtual"],
    },
    {
      id: "fitting",
      name: "Fitting & Measurements",
      durationMinutes: 60,
      description: "In person only.",
      staff: ["Alexandra"],
      locations: ["in-person"],
    },
  ],
};

const AVAILABILITY = {
  timezone: "UTC",
  slots: [
    { start: SLOT_ISO, end: "2026-12-21T15:30:00.000Z", staff: "Alexandra" },
    {
      start: "2026-12-21T15:30:00.000Z",
      end: "2026-12-21T16:00:00.000Z",
      staff: "Alexandra",
    },
  ],
};

test.describe("Appointment booking", () => {
  test("books a consultation end to end (API mocked)", async ({ page }) => {
    await mockAppointmentOptions(page, { body: OPTIONS });
    await mockAppointmentAvailability(page, { body: AVAILABILITY });
    const created = await mockCreateAppointment(page, {
      body: {
        confirmationCode: "APT-TEST01",
        type: "Consultation",
        staff: "Alexandra",
        location: "In person",
        start: SLOT_ISO,
        end: "2026-12-21T15:30:00.000Z",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
      },
    });

    await page.goto("/appointments");
    await expect(
      page.getByRole("heading", { name: "Book an Appointment" }),
    ).toBeVisible();

    // Purpose → Format → Time → Details.
    await page.getByTestId("type-consultation").click();
    await page.getByRole("button", { name: "In person" }).click();
    await page.getByRole("button", { name: "No preference" }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByTestId(`slot-${SLOT_ISO}`).click();

    await page.locator("#fullName").fill("Ada Lovelace");
    await page.locator("#email").fill("ada@example.com");
    await page.getByRole("button", { name: "Confirm Booking" }).click();

    await expect(
      page.getByRole("heading", { name: "You're booked" }),
    ).toBeVisible();
    await expect(page.getByText("APT-TEST01")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "https://meet.google.com/abc-defg-hij" }),
    ).toBeVisible();

    // "No preference" means the request omits `staff`.
    expect(created.requests).toHaveLength(1);
    const body = created.requests[0] as Record<string, unknown>;
    expect(body).toMatchObject({
      typeId: "consultation",
      location: "in-person",
      start: SLOT_ISO,
      fullName: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(body).not.toHaveProperty("staff");
  });

  test("is reachable from the Services nav menu", async ({ page }) => {
    await mockAppointmentOptions(page, { body: OPTIONS });
    await page.goto("/");
    // Desktop dropdown under Services (Radix opens on click).
    await page.getByTestId("nav-services").click();
    await page.getByTestId("nav-book-an-appointment").click();
    await expect(
      page.getByRole("heading", { name: "Book an Appointment" }),
    ).toBeVisible();
  });
});
