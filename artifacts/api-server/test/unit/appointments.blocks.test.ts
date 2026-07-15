import { describe, it, expect } from "vitest";
import {
  buildAppointmentProperties,
  extractBookingEnd,
  extractBookingStaff,
  extractBookingStart,
  type BookedAppointment,
} from "../../src/lib/notion/appointments.blocks.js";

const base: BookedAppointment = {
  customerName: "Ada Lovelace",
  email: "ada@example.com",
  typeName: "Consultation",
  staff: "Alexandra",
  locationLabel: "In person",
  start: new Date("2026-07-20T14:00:00.000Z"),
  end: new Date("2026-07-20T14:30:00.000Z"),
  confirmationCode: "APT-AB12CD",
};

describe("buildAppointmentProperties", () => {
  it("maps the core fields to their Notion property types", () => {
    const props = buildAppointmentProperties(base, "Consultation — Ada") as any;

    expect(props["Name"].title[0].text.content).toBe("Consultation — Ada");
    expect(props["Customer name"].rich_text[0].text.content).toBe(
      "Ada Lovelace",
    );
    expect(props["Email"].email).toBe("ada@example.com");
    expect(props["Appointment type"].select.name).toBe("Consultation");
    expect(props["Staff"].select.name).toBe("Alexandra");
    expect(props["Location"].select.name).toBe("In person");
    expect(props["Start"].date.start).toBe("2026-07-20T14:00:00.000Z");
    expect(props["End"].date.start).toBe("2026-07-20T14:30:00.000Z");
    expect(props["Status"].select.name).toBe("Booked");
    expect(props["Confirmation code"].rich_text[0].text.content).toBe(
      "APT-AB12CD",
    );
  });

  it("omits optional properties when absent", () => {
    const props = buildAppointmentProperties(base, "t") as Record<
      string,
      unknown
    >;
    expect(props).not.toHaveProperty("Phone");
    expect(props).not.toHaveProperty("Notes");
    expect(props).not.toHaveProperty("Preferred contact");
  });

  it("includes optional properties when present", () => {
    const props = buildAppointmentProperties(
      {
        ...base,
        phone: "+1 555 0100",
        notes: "Bringing fabric swatches",
        preferredContact: "text",
      },
      "t",
    ) as any;
    expect(props["Phone"].phone_number).toBe("+1 555 0100");
    expect(props["Notes"].rich_text[0].text.content).toBe(
      "Bringing fabric swatches",
    );
    expect(props["Preferred contact"].select.name).toBe("text");
  });
});

describe("booking extractors", () => {
  const bookingPage = {
    properties: {
      Staff: { select: { name: "Alayna" } },
      Start: { date: { start: "2026-07-20T14:00:00.000Z", end: null } },
      End: { date: { start: "2026-07-20T14:45:00.000Z", end: null } },
    },
  } as never;

  it("reads staff, start, and end back off a page", () => {
    expect(extractBookingStaff(bookingPage)).toBe("Alayna");
    expect(extractBookingStart(bookingPage)?.toISOString()).toBe(
      "2026-07-20T14:00:00.000Z",
    );
    expect(extractBookingEnd(bookingPage)?.toISOString()).toBe(
      "2026-07-20T14:45:00.000Z",
    );
  });

  it("returns null for a missing date", () => {
    expect(extractBookingStart({ properties: {} } as never)).toBeNull();
  });
});
