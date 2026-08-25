// The dashboard's section registry — the addresses, and how a path resolves to
// one. Pure, so it can be pinned without rendering the page.

import { describe, it, expect } from "vitest";
import {
  STUDIO_SECTIONS,
  DEFAULT_STUDIO_SECTION,
  resolveStudioSection,
  studioSectionPath,
} from "@/lib/studio-sections";

describe("the section registry", () => {
  it("has a unique id and a label for every section", () => {
    const ids = STUDIO_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of STUDIO_SECTIONS) {
      expect(section.label.trim()).not.toBe("");
      expect(section.summary.trim()).not.toBe("");
    }
  });

  it("uses ids that are safe in a URL, since each one is an address", () => {
    for (const section of STUDIO_SECTIONS) {
      expect(section.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("includes the default section", () => {
    expect(STUDIO_SECTIONS.map((section) => section.id)).toContain(
      DEFAULT_STUDIO_SECTION,
    );
  });
});

describe("studioSectionPath", () => {
  it("gives the default section the dashboard's own address", () => {
    // One canonical URL per section: `/studio` IS the figures, so there is no
    // second `/studio/figures` for the navbar link and the post-sign-in hop to
    // disagree with.
    expect(studioSectionPath(DEFAULT_STUDIO_SECTION)).toBe("/studio");
  });

  it("gives every other section a path under it", () => {
    for (const section of STUDIO_SECTIONS) {
      if (section.id === DEFAULT_STUDIO_SECTION) continue;
      expect(studioSectionPath(section.id)).toBe(`/studio/${section.id}`);
    }
  });

  it("round-trips through the resolver", () => {
    for (const section of STUDIO_SECTIONS) {
      expect(resolveStudioSection(studioSectionPath(section.id))).toBe(
        section.id,
      );
    }
  });
});

describe("resolveStudioSection", () => {
  it("reads the dashboard's own address as the default section", () => {
    expect(resolveStudioSection("/studio")).toBe(DEFAULT_STUDIO_SECTION);
    expect(resolveStudioSection("/studio/")).toBe(DEFAULT_STUDIO_SECTION);
  });

  it("reads a named section", () => {
    expect(resolveStudioSection("/studio/settings")).toBe("settings");
    expect(resolveStudioSection("/studio/bookings")).toBe("bookings");
  });

  it("accepts the default section spelled out, without minting a second URL", () => {
    expect(resolveStudioSection(`/studio/${DEFAULT_STUDIO_SECTION}`)).toBe(
      DEFAULT_STUDIO_SECTION,
    );
  });

  it("fails OPEN to the default for anything it doesn't recognize", () => {
    // The page's 404 means "you are not staff" — the thing a customer who
    // guessed the URL must see. A stale bookmark to a renamed section is a
    // different matter, and spending that 404 on it would be both unhelpful and
    // a change to what the 404 says.
    expect(resolveStudioSection("/studio/nonsense")).toBe(
      DEFAULT_STUDIO_SECTION,
    );
    expect(resolveStudioSection("/studio/settings/extra")).toBe("settings");
    expect(resolveStudioSection("")).toBe(DEFAULT_STUDIO_SECTION);
  });
});
