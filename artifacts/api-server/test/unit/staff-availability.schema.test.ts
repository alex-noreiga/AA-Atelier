import { describe, it, expect } from "vitest";
import { availabilityPage } from "../support/fake-notion.js";
import {
  extractAvailabilityRecord,
  extractAvailabilityRecords,
  type NotionAvailabilityPage,
} from "../../src/lib/notion/staff-availability.schema.js";

const page = (opts: Parameters<typeof availabilityPage>[0]) =>
  availabilityPage(opts) as unknown as NotionAvailabilityPage;

describe("extractAvailabilityRecord", () => {
  it("maps every property to the schedule entry the mapper consumes", () => {
    expect(
      extractAvailabilityRecord(
        page({
          id: "row-1",
          staff: "Alexandra",
          email: "alexandra@atelier.test",
          weekdays: ["Monday", "Wednesday"],
          start: "10:00",
          end: "17:00",
          locations: ["In person", "Virtual"],
        }),
      ),
    ).toEqual({
      id: "row-1",
      staff: "Alexandra",
      email: "alexandra@atelier.test",
      weekdays: ["Monday", "Wednesday"],
      start: "10:00",
      end: "17:00",
      locations: ["In person", "Virtual"],
    });
  });

  it("reads blank/absent properties as empty rather than throwing", () => {
    const record = extractAvailabilityRecord({
      id: "row-2",
      properties: {},
    });
    expect(record).toEqual({
      id: "row-2",
      staff: "",
      email: "",
      weekdays: [],
      start: "",
      end: "",
      locations: [],
    });
  });

  it("accepts a calendar address typed into a text property", () => {
    // The property is meant to be `email`, but an atelier who added it as text
    // shouldn't end up with a staff member whose calendar can't be resolved.
    const record = extractAvailabilityRecord({
      id: "row-3",
      properties: {
        Staff: { type: "title", title: [{ plain_text: "Alayna" }] },
        "Calendar Email": {
          type: "rich_text",
          rich_text: [{ plain_text: "alayna@atelier.test" }],
        },
      },
    });
    expect(record.email).toBe("alayna@atelier.test");
  });
});

describe("extractAvailabilityRecords", () => {
  it("drops rows with no staff name", () => {
    const records = extractAvailabilityRecords([
      page({ id: "row-1", staff: "Alexandra" }),
      page({ id: "row-2", staff: "" }),
    ]);
    expect(records.map((r) => r.id)).toEqual(["row-1"]);
  });
});
