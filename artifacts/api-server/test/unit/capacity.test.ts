import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_CLOSED_MESSAGE,
  closedMessage,
  commissionCapacity,
  intakeSwitch,
  resolveIntake,
} from "../../src/services/capacity.js";
import {
  __setSettingsSnapshot,
  __resetSettings,
} from "../../src/lib/settings/store.js";

const ENV_KEYS = [
  "COMMISSION_CAPACITY",
  "COMMISSION_INTAKE",
  "COMMISSION_CLOSED_MESSAGE",
];
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  __resetSettings();
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  __resetSettings();
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("resolveIntake", () => {
  const auto = { capacity: 5, override: "auto" as const };

  it("keeps the books open under the cap", () => {
    expect(resolveIntake(4, auto)).toEqual({
      open: true,
      reason: "under-capacity",
    });
  });

  it("closes the books at the cap, not just past it", () => {
    // A capacity of 5 means five in production is full — the sixth is the one
    // there is no room for.
    expect(resolveIntake(5, auto)).toEqual({
      open: false,
      reason: "at-capacity",
    });
    expect(resolveIntake(9, auto)).toEqual({
      open: false,
      reason: "at-capacity",
    });
  });

  it("never closes on an unset cap, however much is in production", () => {
    expect(resolveIntake(200, { capacity: 0, override: "auto" })).toEqual({
      open: true,
      reason: "unlimited",
    });
  });

  it("fails OPEN when the count couldn't be read", () => {
    // The load-bearing degrade: turning a paying customer away because Notion
    // hiccuped is worse than briefly overbooking, and they don't come back to
    // check. `unknown` rather than a silent "0 in production" so the studio
    // panel says which of the two happened.
    expect(resolveIntake(undefined, auto)).toEqual({
      open: true,
      reason: "unknown",
    });
  });

  it("lets the atelier close the books under the cap", () => {
    expect(resolveIntake(0, { capacity: 5, override: "closed" })).toEqual({
      open: false,
      reason: "forced-closed",
    });
  });

  it("lets the atelier hold the books open over the cap", () => {
    expect(resolveIntake(99, { capacity: 5, override: "open" })).toEqual({
      open: true,
      reason: "forced-open",
    });
  });

  it("closes the books with NO cap set, which is the switch's main use", () => {
    // The likeliest real use: the atelier wants the books shut for a month and
    // has never picked a capacity number. `closed` is checked before the
    // no-cap branch precisely so this works without one.
    expect(
      resolveIntake(undefined, { capacity: 0, override: "closed" }),
    ).toEqual({ open: false, reason: "forced-closed" });
    expect(resolveIntake(12, { capacity: 0, override: "closed" })).toEqual({
      open: false,
      reason: "forced-closed",
    });
  });

  it("checks the switch before the count, so an unreadable count can't override it", () => {
    expect(
      resolveIntake(undefined, { capacity: 5, override: "closed" }),
    ).toEqual({ open: false, reason: "forced-closed" });
  });
});

describe("commissionCapacity", () => {
  it("defaults to no cap, so an atelier that never configured this is never closed", () => {
    expect(commissionCapacity()).toBe(0);
  });

  it("prefers the Notion setting over the env var", () => {
    process.env.COMMISSION_CAPACITY = "3";
    __setSettingsSnapshot({ COMMISSION_CAPACITY: "8" });
    expect(commissionCapacity()).toBe(8);
  });

  it("reads an unusable or negative value as no cap", () => {
    // Both directions of "we can't use this" resolve to the open-books answer:
    // a value nobody can parse must not be able to shut the shop.
    __setSettingsSnapshot({ COMMISSION_CAPACITY: "eight" });
    expect(commissionCapacity()).toBe(0);
    __setSettingsSnapshot({ COMMISSION_CAPACITY: "-4" });
    expect(commissionCapacity()).toBe(0);
  });

  it("floors a fractional value rather than rejecting it", () => {
    __setSettingsSnapshot({ COMMISSION_CAPACITY: "6.7" });
    expect(commissionCapacity()).toBe(6);
  });
});

describe("intakeSwitch", () => {
  it("defaults to auto", () => {
    expect(intakeSwitch()).toBe("auto");
  });

  it("accepts open and closed, case- and space-insensitively", () => {
    __setSettingsSnapshot({ COMMISSION_INTAKE: " Closed " });
    expect(intakeSwitch()).toBe("closed");
    __setSettingsSnapshot({ COMMISSION_INTAKE: "OPEN" });
    expect(intakeSwitch()).toBe("open");
  });

  it("reads anything else as auto rather than as a state of its own", () => {
    // "paused" looks like it should close the books; reading it as `closed`
    // would mean a typo could shut the shop, so it degrades to the
    // count-driven behaviour instead.
    __setSettingsSnapshot({ COMMISSION_INTAKE: "paused" });
    expect(intakeSwitch()).toBe("auto");
  });
});

describe("closedMessage", () => {
  it("falls back to the built-in wording", () => {
    expect(closedMessage()).toBe(DEFAULT_CLOSED_MESSAGE);
  });

  it("uses the atelier's own wording when set", () => {
    __setSettingsSnapshot({
      COMMISSION_CLOSED_MESSAGE: "Back in March for 2027-28.",
    });
    expect(closedMessage()).toBe("Back in March for 2027-28.");
  });

  it("treats a whitespace-only message as unset", () => {
    __setSettingsSnapshot({ COMMISSION_CLOSED_MESSAGE: "   " });
    expect(closedMessage()).toBe(DEFAULT_CLOSED_MESSAGE);
  });
});
