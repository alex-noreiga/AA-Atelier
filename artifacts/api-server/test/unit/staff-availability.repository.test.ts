import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
  availabilityPage,
} from "../support/fake-notion.js";

// Module-level TTL cache, so re-import the module fresh per test — same approach
// as product-categories.repository.test.ts.
let repo: typeof import("../../src/lib/notion/staff-availability.repository.js");

beforeEach(async () => {
  vi.resetModules();
  repo = await import("../../src/lib/notion/staff-availability.repository.js");
});

const ENTRY = {
  staff: "Alexandra",
  email: "alexandra@atelier.test",
  weekdays: ["Monday"],
  start: "10:00",
  end: "17:00",
  locations: ["In person"],
};

function queryResponse(
  results: unknown[],
  { hasMore = false, nextCursor = null as string | null } = {},
) {
  return jsonResponse({ results, has_more: hasMore, next_cursor: nextCursor });
}

describe("listStaffAvailability", () => {
  it("throws a pointed error when the database is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(repo.listStaffAvailability(client)).rejects.toThrow(
      /NOTION_STAFF_AVAILABILITY_DATABASE_ID/,
    );
    expect(client.calls).toHaveLength(0);
  });

  it("maps every row and follows pagination", async () => {
    let call = 0;
    const client = makeFakeClient(() => {
      call += 1;
      return call === 1
        ? queryResponse([availabilityPage({ id: "row-1", ...ENTRY })], {
            hasMore: true,
            nextCursor: "cursor-2",
          })
        : queryResponse([availabilityPage({ id: "row-2", staff: "Alayna" })]);
    });

    const records = await repo.listStaffAvailability(client);
    expect(records.map((r) => r.id)).toEqual(["row-1", "row-2"]);
    expect(client.calls).toHaveLength(2);
    expect(JSON.parse(String(client.calls[1].init?.body))).toMatchObject({
      start_cursor: "cursor-2",
    });
  });

  it("caches within the TTL", async () => {
    const client = makeFakeClient(() =>
      queryResponse([availabilityPage({ id: "row-1", staff: "Alexandra" })]),
    );
    await repo.listStaffAvailability(client);
    await repo.listStaffAvailability(client);
    expect(client.calls).toHaveLength(1);
  });

  it("rethrows when Notion errors and nothing has been read yet", async () => {
    const client = makeFakeClient(() => errorResponse(500));
    await expect(repo.listStaffAvailability(client)).rejects.toThrow(
      /status 500/,
    );
  });

  it("keeps serving the last good read through an outage", async () => {
    let fail = false;
    const client = makeFakeClient(() =>
      fail
        ? errorResponse(503)
        : queryResponse([
            availabilityPage({ id: "row-1", staff: "Alexandra" }),
          ]),
    );
    await repo.listStaffAvailability(client);
    fail = true;
    // Past the TTL, so the read is attempted again — and fails.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 120_000));
    expect((await repo.listStaffAvailability(client)).map((r) => r.id)).toEqual(
      ["row-1"],
    );
    vi.useRealTimers();
  });
});

describe("createStaffAvailability", () => {
  it("writes the row and returns it as stored", async () => {
    const client = makeFakeClient(() =>
      jsonResponse(availabilityPage({ id: "row-new", ...ENTRY })),
    );

    const record = await repo.createStaffAvailability(ENTRY, client);
    expect(record.id).toBe("row-new");
    expect(client.calls[0].path).toBe("/v1/pages");
    expect(JSON.parse(String(client.calls[0].init?.body))).toMatchObject({
      parent: { database_id: "test-db-id" },
    });
  });

  it("busts the cache so the next read sees the new row", async () => {
    let listed = [availabilityPage({ id: "row-1", staff: "Alexandra" })];
    const client = makeFakeClient((path) =>
      path === "/v1/pages"
        ? jsonResponse(availabilityPage({ id: "row-2", ...ENTRY }))
        : queryResponse(listed),
    );

    await repo.listStaffAvailability(client);
    listed = [
      availabilityPage({ id: "row-1", staff: "Alexandra" }),
      availabilityPage({ id: "row-2", ...ENTRY }),
    ];
    await repo.createStaffAvailability(ENTRY, client);
    expect((await repo.listStaffAvailability(client)).map((r) => r.id)).toEqual(
      ["row-1", "row-2"],
    );
  });

  it("throws with Notion's own message on a failed write", async () => {
    const client = makeFakeClient(() => errorResponse(400, "bad property"));
    await expect(repo.createStaffAvailability(ENTRY, client)).rejects.toThrow(
      /bad property/,
    );
  });
});

describe("updateStaffAvailability", () => {
  it("patches the page and returns the stored row", async () => {
    const client = makeFakeClient(() =>
      jsonResponse(availabilityPage({ id: "row-1", ...ENTRY })),
    );
    const record = await repo.updateStaffAvailability("row-1", ENTRY, client);
    expect(record?.id).toBe("row-1");
    expect(client.calls[0]).toMatchObject({
      path: "/v1/pages/row-1",
      init: { method: "PATCH" },
    });
  });

  it("returns null when the page is gone", async () => {
    const client = makeFakeClient(() => errorResponse(404, "not found"));
    expect(
      await repo.updateStaffAvailability("row-gone", ENTRY, client),
    ).toBeNull();
  });
});

describe("archiveStaffAvailability", () => {
  it("archives the page (Notion's delete)", async () => {
    const client = makeFakeClient(() =>
      jsonResponse(availabilityPage({ id: "row-1" })),
    );
    expect(await repo.archiveStaffAvailability("row-1", client)).toBe(true);
    expect(JSON.parse(String(client.calls[0].init?.body))).toEqual({
      archived: true,
    });
  });

  it("reports a missing page rather than throwing", async () => {
    const client = makeFakeClient(() => errorResponse(404, "not found"));
    expect(await repo.archiveStaffAvailability("row-gone", client)).toBe(false);
  });
});
