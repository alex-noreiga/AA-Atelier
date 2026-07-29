import { describe, it, expect, afterEach } from "vitest";
import {
  rushSurchargeRate,
  rushSurchargeLineName,
} from "../../src/services/rush.js";
import {
  __setSettingsSnapshot,
  __resetSettings,
} from "../../src/lib/settings/store.js";

const prev = process.env.RUSH_SURCHARGE_RATE;
afterEach(() => {
  if (prev === undefined) delete process.env.RUSH_SURCHARGE_RATE;
  else process.env.RUSH_SURCHARGE_RATE = prev;
  __resetSettings();
});

describe("rushSurchargeRate", () => {
  it("defaults to 0.15 when unset", () => {
    delete process.env.RUSH_SURCHARGE_RATE;
    expect(rushSurchargeRate()).toBe(0.15);
  });

  it("reads a valid override", () => {
    process.env.RUSH_SURCHARGE_RATE = "0.2";
    expect(rushSurchargeRate()).toBe(0.2);
  });

  it("accepts 0 to disable the surcharge", () => {
    process.env.RUSH_SURCHARGE_RATE = "0";
    expect(rushSurchargeRate()).toBe(0);
  });

  it("falls back to the default for an unparseable or negative value", () => {
    process.env.RUSH_SURCHARGE_RATE = "abc";
    expect(rushSurchargeRate()).toBe(0.15);
    process.env.RUSH_SURCHARGE_RATE = "-0.1";
    expect(rushSurchargeRate()).toBe(0.15);
  });

  it("prefers the live Studio Settings value over the env var", () => {
    process.env.RUSH_SURCHARGE_RATE = "0.1";
    __setSettingsSnapshot({ RUSH_SURCHARGE_RATE: "0.25" });
    expect(rushSurchargeRate()).toBe(0.25);
  });
});

describe("rushSurchargeLineName", () => {
  it("formats the rate as a percent, trimming trailing zeros", () => {
    expect(rushSurchargeLineName(0.15)).toBe("Rush surcharge (15%)");
    expect(rushSurchargeLineName(0.2)).toBe("Rush surcharge (20%)");
    expect(rushSurchargeLineName(0.125)).toBe("Rush surcharge (12.5%)");
  });
});
