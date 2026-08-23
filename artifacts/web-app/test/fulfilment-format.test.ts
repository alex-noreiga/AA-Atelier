import { describe, it, expect } from "vitest";
import { formatPickupWhen, fulfilmentStateNote } from "@/lib/fulfilment-format";

describe("formatPickupWhen", () => {
  it("renders a scheduled time in the studio's zone, not the reader's", () => {
    // 14:00 in Chicago, expressed as a UTC instant: a customer reading this in
    // London must still be told to turn up at 2pm studio time.
    const when = formatPickupWhen(
      "2026-09-03T19:00:00.000Z",
      "America/Chicago",
    );
    expect(when).toContain("Thursday");
    expect(when).toContain("September 3");
    expect(when).toContain("2:00");
  });

  it("keeps a bare date on its own day", () => {
    // A date-only value parses as UTC midnight; formatted in a western zone it
    // would slip to the day before, which is the whole reason this branches.
    expect(formatPickupWhen("2026-09-03", "America/Chicago")).toBe(
      "September 3, 2026",
    );
  });

  it("returns nothing for a missing or unparseable value", () => {
    expect(formatPickupWhen(undefined)).toBe("");
    expect(formatPickupWhen("")).toBe("");
    expect(formatPickupWhen("not-a-date-T")).toBe("");
  });
});

describe("fulfilmentStateNote", () => {
  it("says the atelier's column value in words a customer would use", () => {
    expect(fulfilmentStateNote("Packed", "ship")).toBe(
      "Packed and ready to send.",
    );
    expect(fulfilmentStateNote("Packed", "pickup")).toBe(
      "Packed and ready for you to collect.",
    );
  });

  it("matches however the option is cased or punctuated", () => {
    expect(fulfilmentStateNote("to pack", "ship")).toBe(
      "We're packing your order.",
    );
    expect(fulfilmentStateNote("Delivered / Picked up", "pickup")).toBe(
      "Collected — thank you!",
    );
  });

  it("falls back to the atelier's own word for an option it doesn't know", () => {
    // They can add options in Notion whenever they like; silence would lose a
    // fact, and a guess would invent one.
    expect(fulfilmentStateNote("Awaiting courier", "ship")).toBe(
      "Awaiting courier",
    );
  });

  it("says nothing when there is no state", () => {
    expect(fulfilmentStateNote(undefined, "ship")).toBe("");
    expect(fulfilmentStateNote("  ", "pickup")).toBe("");
  });
});
