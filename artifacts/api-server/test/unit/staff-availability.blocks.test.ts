import { describe, it, expect } from "vitest";
import { buildStaffAvailabilityProperties } from "../../src/lib/notion/staff-availability.blocks.js";

describe("buildStaffAvailabilityProperties", () => {
  it("writes the six properties in the types the live schema uses", () => {
    expect(
      buildStaffAvailabilityProperties({
        staff: "Alexandra",
        email: "alexandra@atelier.test",
        weekdays: ["Monday", "Tuesday"],
        start: "10:00",
        end: "17:00",
        locations: ["In person"],
      }),
    ).toEqual({
      Staff: { title: [{ text: { content: "Alexandra" } }] },
      "Calendar Email": { email: "alexandra@atelier.test" },
      Weekdays: {
        multi_select: [{ name: "Monday" }, { name: "Tuesday" }],
      },
      Start: { rich_text: [{ text: { content: "10:00" } }] },
      End: { rich_text: [{ text: { content: "17:00" } }] },
      Locations: { multi_select: [{ name: "In person" }] },
    });
  });
});
