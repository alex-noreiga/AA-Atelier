import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeFakeDb } from "../support/fake-db.js";

// Module-level TTL cache, so re-import the module fresh per test — same approach
// as the other cached repositories.
let repo: typeof import("../../src/lib/db/staff-availability.repository.js");

beforeEach(async () => {
  process.env.POSTGRES_URL = "postgres://test";
  vi.resetModules();
  repo = await import("../../src/lib/db/staff-availability.repository.js");
});

afterEach(() => {
  delete process.env.POSTGRES_URL;
  vi.useRealTimers();
});

const ENTRY = {
  staff: "Alexandra",
  email: "alexandra@atelier.test",
  weekdays: ["Monday", "Wednesday"],
  start: "10:00",
  end: "17:00",
  locations: ["in-person"],
};

/** A row as Postgres hands it back — snake_case, `time` rendered HH:MM:SS. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    staff: "Alexandra",
    calendar_email: "alexandra@atelier.test",
    weekdays: ["Monday", "Wednesday"],
    start_time: "10:00:00",
    end_time: "17:00:00",
    locations: ["in-person"],
    ...overrides,
  };
}

const ID = "11111111-2222-3333-4444-555555555555";

describe("listStaffAvailability", () => {
  it("throws a pointed error when the Postgres layer isn't configured", async () => {
    delete process.env.POSTGRES_URL;
    const db = makeFakeDb(() => []);
    await expect(repo.listStaffAvailability(db)).rejects.toThrow(
      /POSTGRES_URL is not configured/,
    );
    expect(db.calls).toHaveLength(0);
  });

  it("maps rows to schedule entries, trimming the seconds off the times", async () => {
    const db = makeFakeDb(() => [row()]);
    expect(await repo.listStaffAvailability(db)).toEqual([
      {
        id: ID,
        staff: "Alexandra",
        email: "alexandra@atelier.test",
        weekdays: ["Monday", "Wednesday"],
        start: "10:00",
        end: "17:00",
        locations: ["in-person"],
      },
    ]);
  });

  it("caches within the TTL", async () => {
    const db = makeFakeDb(() => [row()]);
    await repo.listStaffAvailability(db);
    await repo.listStaffAvailability(db);
    expect(db.calls).toHaveLength(1);
  });

  it("keeps serving the last good read through an outage", async () => {
    let fail = false;
    const db = makeFakeDb(() => {
      if (fail) throw new Error("connection refused");
      return [row()];
    });

    await repo.listStaffAvailability(db);
    fail = true;
    // Past the TTL, so the read is attempted again — and fails.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 120_000));
    expect((await repo.listStaffAvailability(db)).map((e) => e.id)).toEqual([
      ID,
    ]);
  });

  it("rethrows when the database errors and nothing has been read yet", async () => {
    const db = makeFakeDb(() => {
      throw new Error("connection refused");
    });
    await expect(repo.listStaffAvailability(db)).rejects.toThrow(
      /connection refused/,
    );
  });
});

describe("createStaffAvailability", () => {
  it("inserts the entry and returns it as stored", async () => {
    const db = makeFakeDb(() => [row()]);
    const created = await repo.createStaffAvailability(ENTRY, db);

    expect(created.id).toBe(ID);
    expect(db.calls[0].text).toContain("insert into staff_availability");
    expect(db.calls[0].params).toEqual([
      "Alexandra",
      "alexandra@atelier.test",
      ["Monday", "Wednesday"],
      "10:00",
      "17:00",
      ["in-person"],
    ]);
  });

  it("stores the calendar address canonically", async () => {
    const db = makeFakeDb(() => [row()]);
    await repo.createStaffAvailability(
      { ...ENTRY, email: "  Alexandra@Atelier.TEST " },
      db,
    );
    expect(db.calls[0].params?.[1]).toBe("alexandra@atelier.test");
  });

  it("busts the cache so the next read sees the new row", async () => {
    let listed = [row()];
    const db = makeFakeDb((text) =>
      text.startsWith("insert") ? [row({ id: ID })] : listed,
    );

    await repo.listStaffAvailability(db);
    listed = [row(), row({ id: "99999999-2222-3333-4444-555555555555" })];
    await repo.createStaffAvailability(ENTRY, db);
    expect(await repo.listStaffAvailability(db)).toHaveLength(2);
  });
});

describe("updateStaffAvailability", () => {
  it("replaces the entry and returns the stored row", async () => {
    const db = makeFakeDb(() => [row()]);
    const updated = await repo.updateStaffAvailability(ID, ENTRY, db);

    expect(updated?.id).toBe(ID);
    expect(db.calls[0].text).toContain("update staff_availability");
    expect(db.calls[0].params?.[0]).toBe(ID);
  });

  it("returns null when no such row exists", async () => {
    const db = makeFakeDb(() => []);
    expect(
      await repo.updateStaffAvailability(
        "99999999-2222-3333-4444-555555555555",
        ENTRY,
        db,
      ),
    ).toBeNull();
  });

  it("answers a malformed id without letting the driver reject it", async () => {
    // `id` is a uuid column, so `where id = 'nonsense'` is a driver error rather
    // than an empty result — screening it keeps a junk id a 404, not a 500.
    const db = makeFakeDb(() => {
      throw new Error("invalid input syntax for type uuid");
    });
    expect(
      await repo.updateStaffAvailability("nonsense", ENTRY, db),
    ).toBeNull();
    expect(db.calls).toHaveLength(0);
  });
});

describe("deleteStaffAvailability", () => {
  it("deletes the row", async () => {
    const db = makeFakeDb(() => [{ id: ID }]);
    expect(await repo.deleteStaffAvailability(ID, db)).toBe(true);
    expect(db.calls[0].text).toContain("delete from staff_availability");
  });

  it("reports a row that was already gone", async () => {
    const db = makeFakeDb(() => []);
    expect(await repo.deleteStaffAvailability(ID, db)).toBe(false);
  });

  it("answers a malformed id without querying", async () => {
    const db = makeFakeDb(() => []);
    expect(await repo.deleteStaffAvailability("nonsense", db)).toBe(false);
    expect(db.calls).toHaveLength(0);
  });
});
