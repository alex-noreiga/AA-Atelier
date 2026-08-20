// The `staff_availability` repository over the injectable `DbClient` seam.
//
// The behaviours worth pinning here are the ones the appointment flow leans on
// and a passing typecheck wouldn't catch: the 60s cache (booking re-reads the
// schedule constantly), the fall-back-to-stale-on-error that keeps a database
// blip from emptying the calendar, the cache busting that makes an edit show up
// immediately, and the malformed-id screen that keeps a bad id a 404 instead of
// a 500.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { makeFakeDb } from "../support/fake-db.js";

let repo: typeof import("../../src/lib/db/staff-availability.repository.js");

const UUID = "3f1d2c4e-5a6b-4c8d-9e0f-1a2b3c4d5e6f";

const ROW = {
  id: UUID,
  staff: "Alexandra",
  calendar_email: "alexandra@atelier.test",
  weekdays: ["Monday", "Wednesday"],
  start_time: "10:00",
  end_time: "17:00",
  locations: ["in-person"],
};

const ENTRY = {
  staff: "Alexandra",
  email: "alexandra@atelier.test",
  weekdays: ["Monday", "Wednesday"],
  start: "10:00",
  end: "17:00",
  locations: ["in-person"],
};

beforeEach(async () => {
  vi.resetModules();
  process.env.POSTGRES_URL = "postgres://stub";
  repo = await import("../../src/lib/db/staff-availability.repository.js");
  repo.__resetStaffAvailabilityCache();
});

afterEach(() => {
  delete process.env.POSTGRES_URL;
});

describe("listStaffAvailability", () => {
  it("maps rows to schedule entries", async () => {
    const db = makeFakeDb(() => [ROW]);
    expect(await repo.listStaffAvailability(db)).toEqual([
      { id: UUID, ...ENTRY },
    ]);
  });

  it("reads through the cache on a second call inside the TTL", async () => {
    const db = makeFakeDb(() => [ROW]);
    await repo.listStaffAvailability(db);
    await repo.listStaffAvailability(db);
    expect(db.calls).toHaveLength(1);
  });

  it("falls back to the stale cache when the database errors after the TTL", async () => {
    vi.useFakeTimers();
    try {
      const ok = makeFakeDb(() => [ROW]);
      await repo.listStaffAvailability(ok);

      // Past the TTL, so the next read genuinely re-queries rather than being
      // served from cache — which is what makes this exercise the catch.
      vi.advanceTimersByTime(61_000);

      const failing = makeFakeDb(() => {
        throw new Error("connection terminated");
      });
      expect(await repo.listStaffAvailability(failing)).toEqual([
        { id: UUID, ...ENTRY },
      ]);
      expect(failing.calls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rethrows when the database errors with nothing cached yet", async () => {
    const failing = makeFakeDb(() => {
      throw new Error("connection terminated");
    });
    await expect(repo.listStaffAvailability(failing)).rejects.toThrow(
      /connection terminated/,
    );
  });

  // Called with NO client, which is the only way this reproduces: the check has
  // to beat `getDb()`'s own generic throw, and injecting a fake would skip both.
  it("throws a pointed error naming the schedule when Postgres isn't configured", async () => {
    delete process.env.POSTGRES_URL;
    await expect(repo.listStaffAvailability()).rejects.toThrow(
      /POSTGRES_URL is not configured — the staff working hours/,
    );
  });

  it("keeps that pointed error ahead of getDb() on the write paths too", async () => {
    delete process.env.POSTGRES_URL;
    await expect(repo.createStaffAvailability(ENTRY)).rejects.toThrow(
      /POSTGRES_URL is not configured/,
    );
    await expect(repo.updateStaffAvailability(UUID, ENTRY)).rejects.toThrow(
      /POSTGRES_URL is not configured/,
    );
    await expect(repo.deleteStaffAvailability(UUID)).rejects.toThrow(
      /POSTGRES_URL is not configured/,
    );
  });

  it("tolerates null arrays from a row with no weekdays or locations", async () => {
    const db = makeFakeDb(() => [{ ...ROW, weekdays: null, locations: null }]);
    const [entry] = await repo.listStaffAvailability(db);
    expect(entry.weekdays).toEqual([]);
    expect(entry.locations).toEqual([]);
  });
});

describe("createStaffAvailability", () => {
  it("binds the entry and returns it as stored", async () => {
    const db = makeFakeDb(() => [ROW]);
    expect(await repo.createStaffAvailability(ENTRY, db)).toEqual({
      id: UUID,
      ...ENTRY,
    });
    expect(db.calls[0].params).toEqual([
      "Alexandra",
      "alexandra@atelier.test",
      ["Monday", "Wednesday"],
      "10:00",
      "17:00",
      ["in-person"],
    ]);
  });

  it("busts the cache so the editor sees the new hours immediately", async () => {
    const db = makeFakeDb(() => [ROW]);
    await repo.listStaffAvailability(db);
    await repo.createStaffAvailability(ENTRY, db);
    await repo.listStaffAvailability(db);
    // list, insert, list — the second list re-queried rather than serving stale.
    expect(db.calls).toHaveLength(3);
  });
});

describe("updateStaffAvailability", () => {
  it("returns the updated entry", async () => {
    const db = makeFakeDb(() => [ROW]);
    expect(await repo.updateStaffAvailability(UUID, ENTRY, db)).toEqual({
      id: UUID,
      ...ENTRY,
    });
  });

  it("returns null when no row matched", async () => {
    const db = makeFakeDb(() => []);
    expect(await repo.updateStaffAvailability(UUID, ENTRY, db)).toBeNull();
  });

  it("returns null for a malformed id without querying", async () => {
    const db = makeFakeDb(() => [ROW]);
    expect(
      await repo.updateStaffAvailability("not-a-uuid", ENTRY, db),
    ).toBeNull();
    expect(db.calls).toHaveLength(0);
  });
});

describe("deleteStaffAvailability", () => {
  it("reports the delete and busts the cache", async () => {
    const db = makeFakeDb((text) =>
      text.includes("delete from") ? [{ id: UUID }] : [ROW],
    );
    await repo.listStaffAvailability(db);
    expect(await repo.deleteStaffAvailability(UUID, db)).toBe(true);
    await repo.listStaffAvailability(db);
    expect(db.calls).toHaveLength(3);
  });

  it("reports false when the row was already gone, so a repeat delete 404s", async () => {
    const db = makeFakeDb(() => []);
    expect(await repo.deleteStaffAvailability(UUID, db)).toBe(false);
  });

  it("reports false for a malformed id without querying", async () => {
    const db = makeFakeDb(() => []);
    expect(await repo.deleteStaffAvailability("not-a-uuid", db)).toBe(false);
    expect(db.calls).toHaveLength(0);
  });
});
