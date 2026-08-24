import { describe, it, expect } from "vitest";
import {
  extractCompetition,
  type NotionCompetitionPage,
} from "../../src/lib/notion/competitions.schema.js";

function page(
  overrides: Partial<NotionCompetitionPage["properties"]> = {},
  id = "comp-1",
): NotionCompetitionPage {
  return {
    id,
    properties: {
      Competition: { title: [{ plain_text: "Rocket City Classic" }] },
      Date: { date: { start: "2027-01-16" } },
      Season: { rich_text: [{ plain_text: "2026-27" }] },
      Location: { rich_text: [{ plain_text: "Huntsville, AL" }] },
      ...overrides,
    },
  };
}

describe("extractCompetition", () => {
  it("maps a fully filled-in row", () => {
    expect(extractCompetition(page())).toEqual({
      id: "comp-1",
      name: "Rocket City Classic",
      date: "2027-01-16",
      season: "2026-27",
      location: "Huntsville, AL",
    });
  });

  it("drops a row with no date", () => {
    // Not hypothetical: every row in the live database today has a blank Date.
    // An undated competition can't be sorted by when the piece is needed, which
    // is the only reason to pin a waitlist entry to one.
    expect(extractCompetition(page({ Date: { date: null } }))).toBeNull();
    expect(extractCompetition(page({ Date: {} }))).toBeNull();
  });

  it("drops a row with no name", () => {
    expect(extractCompetition(page({ Competition: { title: [] } }))).toBeNull();
  });

  it("omits season and location when blank rather than disqualifying the row", () => {
    // They're labels on a choice already identified by its name and date, so a
    // row missing them is still perfectly pickable.
    expect(
      extractCompetition(
        page({ Season: { rich_text: [] }, Location: { rich_text: [] } }),
      ),
    ).toEqual({
      id: "comp-1",
      name: "Rocket City Classic",
      date: "2027-01-16",
    });
  });

  it("narrows a datetime to the day", () => {
    // The contract says `format: date`, and the waitlist cares which day.
    expect(
      extractCompetition(
        page({ Date: { date: { start: "2027-01-16T09:30:00.000-06:00" } } }),
      )?.date,
    ).toBe("2027-01-16");
  });

  it("trims and joins a split rich-text value", () => {
    expect(
      extractCompetition(
        page({
          Season: {
            rich_text: [{ plain_text: " 2026" }, { plain_text: "-27 " }],
          },
        }),
      )?.season,
    ).toBe("2026-27");
  });
});
