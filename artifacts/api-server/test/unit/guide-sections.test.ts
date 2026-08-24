import { describe, it, expect } from "vitest";
import { RunStudioToolParams } from "@workspace/api-zod";
import {
  GUIDE_SECTIONS,
  GENERAL_GUIDE_SECTION,
  resolveGuideSection,
} from "../../src/lib/guide-sections.js";

describe("resolveGuideSection", () => {
  it("accepts a section's own id", () => {
    expect(resolveGuideSection("invoice-lines")).toBe("invoice-lines");
    expect(resolveGuideSection("materials")).toBe("materials");
  });

  it("accepts the label the atelier sees instead of the id", () => {
    expect(resolveGuideSection("Itemize an invoice")).toBe("invoice-lines");
    expect(resolveGuideSection("Working hours")).toBe("availability");
  });

  // The Section is typed into a Notion select by hand, so casing, spacing and
  // punctuation are not filing decisions.
  it("ignores case, spacing and punctuation", () => {
    expect(resolveGuideSection("  INVOICE LINES ")).toBe("invoice-lines");
    expect(resolveGuideSection("Cancel and refund an order")).toBe(
      GENERAL_GUIDE_SECTION,
    );
    expect(resolveGuideSection("Cancel & refund an order")).toBe(
      "cancellation-refund",
    );
  });

  // Failing OPEN is the point: a misfiled guide loses its position on the page,
  // never its existence.
  it("falls back to general for anything blank or unrecognized", () => {
    expect(resolveGuideSection(undefined)).toBe(GENERAL_GUIDE_SECTION);
    expect(resolveGuideSection("")).toBe(GENERAL_GUIDE_SECTION);
    expect(resolveGuideSection("   ")).toBe(GENERAL_GUIDE_SECTION);
    expect(resolveGuideSection("Fabric ordering")).toBe(GENERAL_GUIDE_SECTION);
  });

  it("resolves every section it serves, so the vocabulary can't advertise a dead value", () => {
    for (const section of GUIDE_SECTIONS) {
      expect(resolveGuideSection(section.id)).toBe(section.id);
      expect(resolveGuideSection(section.label)).toBe(section.id);
    }
  });

  it("ends with general, which is the section the panel renders", () => {
    expect(GUIDE_SECTIONS.at(-1)?.id).toBe(GENERAL_GUIDE_SECTION);
  });

  // The dashboard renders `<GuidesFor section={spec.tool} />` inside every tool
  // card, so a tool with no section here is a render point nothing can resolve
  // to: the guide still exists, it just silently never appears beside its
  // button. `quote` was missing for exactly that reason. Driven off the
  // contract's own enum rather than a hand-copied list, so a tool added to the
  // spec without a section fails here.
  it("has a section for every studio tool, so no tool card is unreachable", () => {
    const tools = RunStudioToolParams.shape.tool.options;
    const ids = new Set(GUIDE_SECTIONS.map((section) => section.id));
    const missing = tools.filter((tool) => !ids.has(tool));
    expect(missing).toEqual([]);
  });
});
