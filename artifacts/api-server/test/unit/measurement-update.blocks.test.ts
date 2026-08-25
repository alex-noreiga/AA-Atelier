import { describe, it, expect } from "vitest";
import {
  buildMeasurementProperties,
  buildMeasurementRevisionBlocks,
} from "../../src/lib/notion/orders.blocks.js";

const VALUES = {
  waist: 26,
  bust: 34,
  hips: 36,
  height: 64,
  bodyGirth: 55,
  measurementUnit: "inches" as const,
};

/** Read a paragraph block's "Label: value" back as a flat string. */
function paragraphText(block: unknown): string {
  const rich = (
    block as {
      paragraph?: { rich_text?: Array<{ text: { content: string } }> };
    }
  ).paragraph?.rich_text;
  return (rich ?? []).map((part) => part.text.content).join("");
}

function paragraphs(blocks: unknown[]): string[] {
  return blocks
    .filter((b) => (b as { type: string }).type === "paragraph")
    .map(paragraphText);
}

describe("buildMeasurementProperties", () => {
  it("writes the five numbers under their Notion property names", () => {
    expect(buildMeasurementProperties(VALUES)).toEqual({
      Waist: { number: 26 },
      // The contract's `bust` is stored under the neutral "Chest" label.
      Chest: { number: 34 },
      Hips: { number: 36 },
      Height: { number: 64 },
      "Body Girth": { number: 55 },
      "Measurement Unit": { select: { name: "inches" } },
    });
  });

  it("always writes the unit alongside the values", () => {
    // The unit is what gives the numbers meaning: a patch that rewrote a waist
    // without it is how 26 inches silently becomes 26 centimetres.
    const properties = buildMeasurementProperties({
      ...VALUES,
      measurementUnit: "cm",
    });
    expect(properties["Measurement Unit"]).toEqual({
      select: { name: "cm" },
    });
  });
});

describe("buildMeasurementRevisionBlocks", () => {
  it("notes what each changed value was, and stays quiet about the rest", () => {
    const blocks = buildMeasurementRevisionBlocks({
      values: VALUES,
      previous: { measurementUnit: "inches", waist: 25, bust: 34 },
      changedOn: "August 25, 2026",
    });
    const lines = paragraphs(blocks);

    expect(lines).toContain("Waist: 26 (was 25)");
    // Unchanged values carry no "was" — a revision listing five values as
    // changes buries the one that actually moved.
    expect(lines).toContain("Chest: 34");
    // Nothing was on file for these, so there is nothing to compare against.
    expect(lines).toContain("Hips: 36");
  });

  it("heads the section with the date and the unit", () => {
    const blocks = buildMeasurementRevisionBlocks({
      values: VALUES,
      changedOn: "August 25, 2026",
    });
    const heading = blocks.find(
      (b) => (b as { type: string }).type === "heading_2",
    ) as { heading_2: { rich_text: Array<{ text: { content: string } }> } };

    expect(heading.heading_2.rich_text[0].text.content).toBe(
      "Measurements updated August 25, 2026 (inches)",
    );
  });

  it("says so when the values were previously recorded in another unit", () => {
    // Otherwise "Waist: 66 (was 26)" reads as a customer who grew 40 inches,
    // rather than one who switched from inches to centimetres.
    const blocks = buildMeasurementRevisionBlocks({
      values: { ...VALUES, measurementUnit: "cm" },
      previous: { measurementUnit: "inches", waist: 25 },
      changedOn: "August 25, 2026",
    });

    expect(paragraphs(blocks)[0]).toContain("Previously recorded in inches");
  });

  it("records the customer's note when there is one, and no empty row when not", () => {
    const withNote = paragraphs(
      buildMeasurementRevisionBlocks({
        values: VALUES,
        note: "Waist a touch bigger",
        changedOn: "August 25, 2026",
      }),
    );
    expect(withNote).toContain("Customer note: Waist a touch bigger");

    const without = paragraphs(
      buildMeasurementRevisionBlocks({
        values: VALUES,
        changedOn: "August 25, 2026",
      }),
    );
    expect(without.some((line) => line.startsWith("Customer note"))).toBe(
      false,
    );
  });
});
