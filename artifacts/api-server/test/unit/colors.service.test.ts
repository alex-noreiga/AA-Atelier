import { describe, it, expect, afterEach } from "vitest";
import {
  parseColorPalette,
  intakeColorPalette,
} from "../../src/services/colors.js";
import {
  __setSettingsSnapshot,
  __resetSettings,
} from "../../src/lib/settings/store.js";

const prev = process.env.COLOR_PALETTE;
afterEach(() => {
  if (prev === undefined) delete process.env.COLOR_PALETTE;
  else process.env.COLOR_PALETTE = prev;
  __resetSettings();
});

describe("parseColorPalette", () => {
  it("parses `Name #hex` entries, slugging the id", () => {
    expect(parseColorPalette("Emerald #0B6E4F, Navy #1F2A44")).toEqual([
      { id: "emerald", name: "Emerald", hex: "#0B6E4F" },
      { id: "navy", name: "Navy", hex: "#1F2A44" },
    ]);
  });

  it("keeps multi-word names and 3-digit hex", () => {
    expect(parseColorPalette("Rose Gold #fff")).toEqual([
      { id: "rose-gold", name: "Rose Gold", hex: "#fff" },
    ]);
  });

  it("skips entries with a missing or invalid hex", () => {
    expect(
      parseColorPalette("Good #123456, NoHex, Bad #12, Worse #GGGGGG"),
    ).toEqual([{ id: "good", name: "Good", hex: "#123456" }]);
  });

  it("drops later duplicates by slug", () => {
    expect(parseColorPalette("Ivory #F3ECE2, ivory #FFFFFF")).toEqual([
      { id: "ivory", name: "Ivory", hex: "#F3ECE2" },
    ]);
  });

  it("returns [] for a blank or fully-invalid string", () => {
    expect(parseColorPalette("   ")).toEqual([]);
    expect(parseColorPalette("nope, still nope")).toEqual([]);
  });
});

describe("intakeColorPalette", () => {
  it("returns the built-in primary palette when unset", () => {
    delete process.env.COLOR_PALETTE;
    const palette = intakeColorPalette();
    expect(palette.length).toBeGreaterThan(0);
    // Every default color carries an id, name, and a hex fill.
    expect(palette.every((c) => c.id && c.name && /^#[0-9a-fA-F]{6}$/.test(c.hex)))
      .toBe(true);
    expect(palette.map((c) => c.name)).toContain("Red");
  });

  it("parses the env override", () => {
    process.env.COLOR_PALETTE = "Emerald #0B6E4F";
    expect(intakeColorPalette()).toEqual([
      { id: "emerald", name: "Emerald", hex: "#0B6E4F" },
    ]);
  });

  it("prefers the live Studio Settings value over the env var", () => {
    process.env.COLOR_PALETTE = "Emerald #0B6E4F";
    __setSettingsSnapshot({ COLOR_PALETTE: "Navy #1F2A44" });
    expect(intakeColorPalette()).toEqual([
      { id: "navy", name: "Navy", hex: "#1F2A44" },
    ]);
  });

  it("falls back to the default when the override is entirely unparseable", () => {
    process.env.COLOR_PALETTE = "nonsense with no hex";
    expect(intakeColorPalette().length).toBeGreaterThan(1);
  });
});
