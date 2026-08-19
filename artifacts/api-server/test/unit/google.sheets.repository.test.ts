import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { GoogleSheetsClient } from "../../src/lib/google/client.js";

// The repository keeps a module-level TTL cache, so each test imports a fresh
// copy of the module to start clean — same approach as products.repository.test.
let repo: typeof import("../../src/lib/google/sheets.repository.js");

beforeEach(async () => {
  vi.resetModules();
  process.env.APPOINTMENT_SHEET_ID = "sheet-123";
  delete process.env.APPOINTMENT_SHEET_RANGE;
  repo = await import("../../src/lib/google/sheets.repository.js");
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A fake Sheets client returning canned responses and recording paths. */
function fakeClient(
  impl: (path: string) => Response,
): GoogleSheetsClient & { paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    async fetch(path) {
      paths.push(path);
      return impl(path);
    },
  };
}

const VALUES = [
  [
    "Alexandra",
    "alexandra@atelier.test",
    "Mon-Fri",
    "10:00",
    "17:00",
    "in-person, virtual",
  ],
  ["Alayna", "alayna@atelier.test", "Sat", "11:00", "16:00", "virtual"],
];

describe("getStaffSchedule", () => {
  it("reads the A2:F range and parses rows into the schedule", async () => {
    const client = fakeClient(() => jsonResponse({ values: VALUES }));
    const schedule = await repo.getStaffSchedule(client);

    expect(client.paths[0]).toBe("/spreadsheets/sheet-123/values/A2%3AF");
    expect(schedule.calendars.get("Alexandra")).toBe("alexandra@atelier.test");
    expect(schedule.calendars.get("Alayna")).toBe("alayna@atelier.test");
    expect(
      schedule.weeklyHours.filter((h) => h.staff === "Alexandra"),
    ).toHaveLength(5);
    expect(
      schedule.weeklyHours.find((h) => h.staff === "Alayna"),
    ).toMatchObject({
      weekday: "Saturday",
      startMinutes: 660,
      endMinutes: 960,
      locations: ["virtual"],
    });
  });

  it("caches within the TTL (one fetch for repeated calls)", async () => {
    const client = fakeClient(() => jsonResponse({ values: VALUES }));
    await repo.getStaffSchedule(client);
    await repo.getStaffSchedule(client);
    expect(client.paths).toHaveLength(1);
  });

  it("retries a transient failure and succeeds", async () => {
    let calls = 0;
    const client = fakeClient(() => {
      calls += 1;
      // Google's Sheets backend 503s intermittently; the second call works.
      return calls === 1
        ? jsonResponse({}, 503)
        : jsonResponse({ values: VALUES });
    });

    const schedule = await repo.getStaffSchedule(client);

    expect(client.paths).toHaveLength(2);
    expect(schedule.calendars.get("Alayna")).toBe("alayna@atelier.test");
  });

  it("falls back to the cached value when a later fetch fails", async () => {
    vi.useFakeTimers();
    try {
      let ok = true;
      const client = fakeClient(() =>
        ok ? jsonResponse({ values: VALUES }) : jsonResponse({}, 503),
      );
      const first = await repo.getStaffSchedule(client);
      ok = false;
      await vi.advanceTimersByTimeAsync(61_000); // past the 60s TTL
      // Drive the retry backoff too, so the fallback is reached deterministically.
      const pending = repo.getStaffSchedule(client);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toEqual(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws a 503-mapped ServiceUnavailableError when Sheets is down and nothing is cached", async () => {
    const client = fakeClient(() => jsonResponse({}, 503));
    // Asserted by name, not `instanceof`: the `vi.resetModules()` above gives
    // the repository its own copy of the errors module, so the classes differ.
    const error = await repo
      .getStaffSchedule(client)
      .then(() => null)
      .catch((e: Error) => e);
    expect(error?.name).toBe("ServiceUnavailableError");
    expect(error?.message).toMatch(/temporarily unavailable/);
    expect(client.paths).toHaveLength(3); // the initial call + two retries
  });

  it("rethrows a non-transient failure (a misconfigured or unshared sheet)", async () => {
    const client = fakeClient(() => jsonResponse({}, 403));
    await expect(repo.getStaffSchedule(client)).rejects.toThrow(/status 403/);
    expect(client.paths).toHaveLength(1); // not retried — it won't fix itself
  });

  it("throws when APPOINTMENT_SHEET_ID is unset", async () => {
    delete process.env.APPOINTMENT_SHEET_ID;
    const client = fakeClient(() => jsonResponse({ values: VALUES }));
    await expect(repo.getStaffSchedule(client)).rejects.toThrow(
      /APPOINTMENT_SHEET_ID/,
    );
  });
});

describe("calendarEmailFor", () => {
  it("resolves a staff member's calendar email from the sheet", async () => {
    const client = fakeClient(() => jsonResponse({ values: VALUES }));
    expect(await repo.calendarEmailFor("Alayna", client)).toBe(
      "alayna@atelier.test",
    );
    expect(await repo.calendarEmailFor("Nobody", client)).toBeUndefined();
  });
});
