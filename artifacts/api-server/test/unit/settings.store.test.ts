import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Notion read so priming is deterministic and offline.
vi.mock("../../src/lib/notion/settings.repository.js", () => ({
  fetchStudioSettings: vi.fn(),
}));

import {
  primeSettings,
  settingValue,
  __setSettingsSnapshot,
  __resetSettings,
} from "../../src/lib/settings/store.js";
import { fetchStudioSettings } from "../../src/lib/notion/settings.repository.js";

const mockFetch = vi.mocked(fetchStudioSettings);

beforeEach(() => {
  __resetSettings();
});

describe("settings store", () => {
  it("returns undefined for any key before priming", () => {
    expect(settingValue("RUSH_SURCHARGE_RATE")).toBeUndefined();
  });

  it("exposes values from the primed Notion snapshot", async () => {
    mockFetch.mockResolvedValue(
      new Map([
        ["RUSH_SURCHARGE_RATE", "0.25"],
        ["APPOINTMENT_TIMEZONE", "America/New_York"],
      ]),
    );
    await primeSettings();
    expect(settingValue("RUSH_SURCHARGE_RATE")).toBe("0.25");
    expect(settingValue("APPOINTMENT_TIMEZONE")).toBe("America/New_York");
    expect(settingValue("NOT_SET")).toBeUndefined();
  });

  it("treats an empty/whitespace value as unset", () => {
    __setSettingsSnapshot({ ALERT_INBOX_EMAIL: "   " });
    expect(settingValue("ALERT_INBOX_EMAIL")).toBeUndefined();
  });

  it("re-priming replaces the whole snapshot", async () => {
    __setSettingsSnapshot({ RUSH_SURCHARGE_RATE: "0.5" });
    mockFetch.mockResolvedValue(new Map([["APPOINTMENT_TIMEZONE", "UTC"]]));
    await primeSettings();
    expect(settingValue("RUSH_SURCHARGE_RATE")).toBeUndefined();
    expect(settingValue("APPOINTMENT_TIMEZONE")).toBe("UTC");
  });
});
