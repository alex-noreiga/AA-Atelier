import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The Notion adapter is faked: this suite is about the resolution rules, which
// are the part that has to mirror the runtime exactly.
vi.mock("../../src/lib/notion/settings.repository.js", () => ({
  fetchSettingRows: vi.fn(),
  settingsConfigured: vi.fn(),
  saveSetting: vi.fn(),
}));

import {
  getStudioSettings,
  saveStudioSetting,
  resolveSetting,
  unknownRows,
} from "../../src/services/studio-settings.service.js";
import {
  fetchSettingRows,
  settingsConfigured,
  saveSetting,
} from "../../src/lib/notion/settings.repository.js";
import { settingDefinition } from "../../src/lib/settings/catalog.js";

const mockRows = vi.mocked(fetchSettingRows);
const mockConfigured = vi.mocked(settingsConfigured);
const mockSave = vi.mocked(saveSetting);

const RUSH = settingDefinition("RUSH_SURCHARGE_RATE")!;
const INBOX = settingDefinition("ATELIER_INBOX_EMAIL")!;

const savedEnv = new Map<string, string | undefined>();

function setEnv(key: string, value: string | undefined): void {
  if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  mockConfigured.mockReturnValue(true);
  mockRows.mockResolvedValue([]);
  mockSave.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
});

describe("resolveSetting", () => {
  it("reports the built-in default when nothing is configured", () => {
    const view = resolveSetting(RUSH, undefined, undefined);
    expect(view.source).toBe("default");
    expect(view.effectiveValue).toBe("0.15");
    expect(view.notionValue).toBeUndefined();
    expect(view.envValue).toBeUndefined();
    expect(view.ignoredValue).toBeUndefined();
  });

  it("reports the environment when only it is set", () => {
    const view = resolveSetting(RUSH, undefined, "0.25");
    expect(view.source).toBe("environment");
    expect(view.effectiveValue).toBe("0.25");
    expect(view.envValue).toBe("0.25");
  });

  it("prefers Notion over the environment, and shows both", () => {
    const view = resolveSetting(RUSH, "0.2", "0.25");
    expect(view.source).toBe("notion");
    expect(view.effectiveValue).toBe("0.2");
    expect(view.notionValue).toBe("0.2");
    expect(view.envValue).toBe("0.25");
  });

  it("falls back to the DEFAULT — not the environment — when Notion is unusable", () => {
    // This mirrors the getters: they read `settingValue ?? process.env`, so an
    // unusable Notion value never reaches the variable sitting behind it.
    // Reporting "environment" here would be wrong in the one case someone opens
    // this page to understand.
    const view = resolveSetting(RUSH, "fifteen percent", "0.25");
    expect(view.source).toBe("default");
    expect(view.effectiveValue).toBe("0.15");
    expect(view.ignoredValue).toBe("fifteen percent");
    expect(view.envValue).toBe("0.25");
  });

  it("names an unusable environment value too", () => {
    const view = resolveSetting(RUSH, undefined, "lots");
    expect(view.source).toBe("default");
    expect(view.ignoredValue).toBe("lots");
  });

  it("judges a stored value by what the RUNTIME accepts, not what the editor would save", () => {
    // The editor refuses `15` (it would price a 1500% surcharge), but the
    // runtime honours it — so a row already holding it is in force, and saying
    // otherwise would be a lie about the running app.
    expect(RUSH.validate("15")).not.toBeNull();
    const view = resolveSetting(RUSH, "15", undefined);
    expect(view.source).toBe("notion");
    expect(view.ignoredValue).toBeUndefined();
  });

  it("carries the phrasing for a fallback that isn't a value", () => {
    const view = resolveSetting(INBOX, undefined, undefined);
    expect(view.defaultValue).toBe("");
    expect(view.defaultLabel).toMatch(/skipped/i);
  });
});

describe("unknownRows", () => {
  it("ignores rows that are settings", () => {
    expect(
      unknownRows([{ pageId: "p1", key: "RUSH_SURCHARGE_RATE", value: "0.2" }]),
    ).toEqual([]);
  });

  it("names a row nothing reads, and what it was probably meant to be", () => {
    const rows = unknownRows([
      { pageId: "p1", key: "RUSH_SURCHARGE_RAT", value: "0.2" },
    ]);
    expect(rows).toEqual([
      {
        key: "RUSH_SURCHARGE_RAT",
        value: "0.2",
        suggestion: "RUSH_SURCHARGE_RATE",
      },
    ]);
  });

  it("matches a key typed as prose in the Notion title", () => {
    const rows = unknownRows([
      { pageId: "p1", key: "Rush Surcharge Rate", value: "0.2" },
    ]);
    expect(rows[0]?.suggestion).toBe("RUSH_SURCHARGE_RATE");
  });

  it("offers no suggestion when nothing is close", () => {
    const rows = unknownRows([
      { pageId: "p1", key: "NOTES_FOR_ALAYNA", value: "" },
    ]);
    expect(rows).toEqual([{ key: "NOTES_FOR_ALAYNA" }]);
  });
});

describe("getStudioSettings", () => {
  it("resolves every key, and reports the rows that aren't settings", async () => {
    setEnv("RUSH_SURCHARGE_RATE", undefined);
    setEnv("ALERT_INBOX_EMAIL", "alerts@example.com");
    mockRows.mockResolvedValue([
      { pageId: "p1", key: "RUSH_SURCHARGE_RATE", value: "0.2" },
      { pageId: "p2", key: "APPOINTMENT_TIMEZON", value: "Europe/London" },
    ]);

    const overview = await getStudioSettings();

    expect(overview.configured).toBe(true);
    const rush = overview.settings.find((s) => s.key === "RUSH_SURCHARGE_RATE");
    expect(rush?.source).toBe("notion");
    expect(rush?.effectiveValue).toBe("0.2");
    const alert = overview.settings.find((s) => s.key === "ALERT_INBOX_EMAIL");
    expect(alert?.source).toBe("environment");
    expect(overview.unknownRows).toEqual([
      {
        key: "APPOINTMENT_TIMEZON",
        value: "Europe/London",
        suggestion: "APPOINTMENT_TIMEZONE",
      },
    ]);
  });

  it("treats a blank Value as unset, exactly as the settings map does", async () => {
    setEnv("RUSH_SURCHARGE_RATE", undefined);
    mockRows.mockResolvedValue([
      { pageId: "p1", key: "RUSH_SURCHARGE_RATE", value: "   " },
    ]);
    const overview = await getStudioSettings();
    const rush = overview.settings.find((s) => s.key === "RUSH_SURCHARGE_RATE");
    expect(rush?.source).toBe("default");
    expect(rush?.notionValue).toBeUndefined();
  });

  it("still reports every setting when there's no database at all", async () => {
    mockConfigured.mockReturnValue(false);
    const overview = await getStudioSettings();
    expect(overview.configured).toBe(false);
    expect(overview.settings.length).toBeGreaterThan(0);
    // Nothing to read, so it never asks.
    expect(mockRows).not.toHaveBeenCalled();
  });
});

describe("saveStudioSetting", () => {
  it("writes a valid value and returns the setting as it now stands", async () => {
    setEnv("RUSH_SURCHARGE_RATE", undefined);
    const saved = await saveStudioSetting("RUSH_SURCHARGE_RATE", "0.2");
    expect(mockSave).toHaveBeenCalledWith(
      "RUSH_SURCHARGE_RATE",
      "0.2",
      RUSH.description,
    );
    expect(saved.source).toBe("notion");
    expect(saved.effectiveValue).toBe("0.2");
  });

  it("refuses a value the setting can't take, and writes nothing", async () => {
    await expect(
      saveStudioSetting("RUSH_SURCHARGE_RATE", "15"),
    ).rejects.toThrow(/between 0 and 1/);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("refuses a key the app doesn't read", async () => {
    await expect(
      saveStudioSetting("STRIPE_SECRET_KEY", "sk_live_x"),
    ).rejects.toThrow(/isn't a setting this app reads/);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("clears a setting when the value is blank, handing it back to env/default", async () => {
    setEnv("RUSH_SURCHARGE_RATE", "0.25");
    const saved = await saveStudioSetting("RUSH_SURCHARGE_RATE", "  ");
    expect(mockSave).toHaveBeenCalledWith(
      "RUSH_SURCHARGE_RATE",
      "",
      RUSH.description,
    );
    expect(saved.source).toBe("environment");
    expect(saved.effectiveValue).toBe("0.25");
  });

  it("refuses to write at all when there's no settings database", async () => {
    mockConfigured.mockReturnValue(false);
    await expect(
      saveStudioSetting("RUSH_SURCHARGE_RATE", "0.2"),
    ).rejects.toThrow(/no Studio Settings database/);
    expect(mockSave).not.toHaveBeenCalled();
  });
});
