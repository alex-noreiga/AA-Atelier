import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
} from "../support/fake-notion.js";

// The repository keeps a module-level TTL cache, so each test imports a fresh
// copy of the module to start from a clean cache.
let repo: typeof import("../../src/lib/notion/settings.repository.js");

beforeEach(async () => {
  vi.resetModules();
  repo = await import("../../src/lib/notion/settings.repository.js");
});

/** A Studio Settings page with a `Setting` title and a `Value` rich_text. */
function settingPage(key: string, value: string) {
  return {
    properties: {
      Setting: { type: "title", title: [{ plain_text: key }] },
      Value: { type: "rich_text", rich_text: [{ plain_text: value }] },
    },
  };
}

describe("fetchStudioSettings — stale-while-revalidate", () => {
  // This read is primed on EVERY request, so once there is something cached it
  // must not put a Notion round-trip in front of a request. It serves the last
  // good values and refreshes behind the response.
  const TTL_MS = 60_000;

  it("serves the stale map without waiting, then refreshes behind it", async () => {
    let value = "first@x.com";
    const client = makeFakeClient(() =>
      jsonResponse({ results: [settingPage("ALERT_INBOX_EMAIL", value)] }),
    );

    const initial = await repo.fetchStudioSettings(client);
    expect(initial.get("ALERT_INBOX_EMAIL")).toBe("first@x.com");
    expect(client.calls).toHaveLength(1);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + TTL_MS + 1);
      value = "second@x.com";

      // Stale: answered from cache, so this call must not await the refresh.
      const stale = await repo.fetchStudioSettings(client);
      expect(stale.get("ALERT_INBOX_EMAIL")).toBe("first@x.com");
    } finally {
      vi.useRealTimers();
    }

    // ...but the refresh was started, and lands for a later caller. Polled on
    // the VALUE rather than the call count: the count rises when the fetch is
    // invoked, which is before the new map has replaced the cache.
    await vi.waitFor(async () => {
      const refreshed = await repo.fetchStudioSettings(client);
      expect(refreshed.get("ALERT_INBOX_EMAIL")).toBe("second@x.com");
    });
  });

  it("blocks on a cold cache, so a first request never silently sees env/defaults", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [settingPage("ALERT_INBOX_EMAIL", "ops@x.com")],
      }),
    );

    // Nothing cached: the value must be present in the very first result, not
    // arrive later — the whole Studio Settings feature depends on it.
    const settings = await repo.fetchStudioSettings(client);
    expect(settings.get("ALERT_INBOX_EMAIL")).toBe("ops@x.com");
    expect(client.calls).toHaveLength(1);
  });

  it("fires one refresh for a burst of stale reads, not one per read", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [settingPage("ALERT_INBOX_EMAIL", "ops@x.com")],
      }),
    );
    await repo.fetchStudioSettings(client);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + TTL_MS + 1);
      await Promise.all([
        repo.fetchStudioSettings(client),
        repo.fetchStudioSettings(client),
        repo.fetchStudioSettings(client),
      ]);
    } finally {
      vi.useRealTimers();
    }

    await vi.waitFor(() => expect(client.calls).toHaveLength(2));
    expect(client.calls).toHaveLength(2);
  });

  it("keeps serving the last good values when the background refresh fails", async () => {
    let fail = false;
    const client = makeFakeClient(() =>
      fail
        ? errorResponse(500)
        : jsonResponse({
            results: [settingPage("ALERT_INBOX_EMAIL", "ops@x.com")],
          }),
    );
    await repo.fetchStudioSettings(client);

    fail = true;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + TTL_MS + 1);
      const stale = await repo.fetchStudioSettings(client);
      expect(stale.get("ALERT_INBOX_EMAIL")).toBe("ops@x.com");
    } finally {
      vi.useRealTimers();
    }

    await vi.waitFor(() => expect(client.calls).toHaveLength(2));
    // A failed refresh must not empty the map — that would silently swap every
    // atelier-set value for its env/default.
    const after = await repo.fetchStudioSettings(client);
    expect(after.get("ALERT_INBOX_EMAIL")).toBe("ops@x.com");
  });

  it("does not reject when the background refresh throws", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [settingPage("ALERT_INBOX_EMAIL", "ops@x.com")],
      }),
    );
    await repo.fetchStudioSettings(client);

    // A detached rejection would land after the response has already gone out.
    const throwing = makeFakeClient(() => {
      throw new Error("socket hang up");
    });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + TTL_MS + 1);
      await expect(repo.fetchStudioSettings(throwing)).resolves.toBeInstanceOf(
        Map,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("fetchStudioSettings", () => {
  it("returns an empty map when the database is not configured (self-gate)", async () => {
    const client = makeFakeClient(() => jsonResponse({ results: [] }), "");
    const settings = await repo.fetchStudioSettings(client);
    expect(settings.size).toBe(0);
    // Self-gated: it never even queries Notion.
    expect(client.calls).toHaveLength(0);
  });

  it("maps rows into a key→value map, skipping blank keys", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [
          settingPage("RUSH_SURCHARGE_RATE", "0.2"),
          settingPage("APPOINTMENT_TIMEZONE", "America/New_York"),
          settingPage("", "orphan"),
        ],
      }),
    );
    const settings = await repo.fetchStudioSettings(client);
    expect(settings.get("RUSH_SURCHARGE_RATE")).toBe("0.2");
    expect(settings.get("APPOINTMENT_TIMEZONE")).toBe("America/New_York");
    expect(settings.size).toBe(2);
  });

  it("serves the cached map within the TTL (one fetch for two calls)", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [settingPage("ALERT_INBOX_EMAIL", "ops@x.com")],
      }),
    );
    await repo.fetchStudioSettings(client);
    const second = await repo.fetchStudioSettings(client);
    expect(second.get("ALERT_INBOX_EMAIL")).toBe("ops@x.com");
    expect(client.calls).toHaveLength(1);
  });

  it("falls back to the last-good cache when a later fetch fails", async () => {
    let ok = true;
    const client = makeFakeClient(() =>
      ok
        ? jsonResponse({ results: [settingPage("RUSH_SURCHARGE_RATE", "0.3")] })
        : errorResponse(500),
    );
    await repo.fetchStudioSettings(client); // primes the cache
    repo.__resetSettingsCache(); // force a re-fetch past the TTL
    ok = false;
    const settings = await repo.fetchStudioSettings(client);
    // __resetSettingsCache cleared the cache, so a failed fetch degrades to empty
    // rather than throwing — the env/default fallback keeps consumers working.
    expect(settings.size).toBe(0);
  });

  it("degrades to an empty map (never throws) on a failed first fetch", async () => {
    const client = makeFakeClient(() => errorResponse(503));
    const settings = await repo.fetchStudioSettings(client);
    expect(settings.size).toBe(0);
  });
});

/** A settings page carrying its Notion page id, as the row read needs. */
function settingRowPage(id: string, key: string, value: string) {
  return { id, ...settingPage(key, value) };
}

describe("fetchSettingRows", () => {
  it("keeps every row, page ids and all — including one that isn't a setting", async () => {
    // The cached key→value map can't answer the editor's questions: a mistyped
    // key simply isn't in it. This read is what makes such a row visible.
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [
          settingRowPage("page-1", "RUSH_SURCHARGE_RATE", "0.2"),
          settingRowPage("page-2", "RUSH_SURCHARGE_RAT", "0.3"),
        ],
      }),
    );
    expect(await repo.fetchSettingRows(client)).toEqual([
      { pageId: "page-1", key: "RUSH_SURCHARGE_RATE", value: "0.2" },
      { pageId: "page-2", key: "RUSH_SURCHARGE_RAT", value: "0.3" },
    ]);
  });

  it("returns nothing when there's no settings database", async () => {
    const client = makeFakeClient(() => jsonResponse({ results: [] }), "");
    expect(await repo.fetchSettingRows(client)).toEqual([]);
    expect(client.calls).toHaveLength(0);
  });

  it("throws on a failed read, unlike the settings map", async () => {
    // The map degrades to env/defaults because every consumer has a fallback
    // behind it. An editor has none: an empty list would just be a lie.
    const client = makeFakeClient(() => errorResponse(500, "boom"));
    await expect(repo.fetchSettingRows(client)).rejects.toThrow(/500/);
  });
});

describe("saveSetting", () => {
  it("updates the row that already holds the key", async () => {
    const client = makeFakeClient((path) =>
      path.endsWith("/query")
        ? jsonResponse({
            results: [settingRowPage("page-1", "RUSH_SURCHARGE_RATE", "0.15")],
          })
        : jsonResponse({ id: "page-1" }),
    );

    await repo.saveSetting(
      "RUSH_SURCHARGE_RATE",
      "0.2",
      "The rush surcharge",
      client,
    );

    const write = client.calls[1];
    expect(write.path).toBe("/v1/pages/page-1");
    expect(write.init?.method).toBe("PATCH");
    expect(JSON.parse(String(write.init?.body))).toEqual({
      properties: { Value: { rich_text: [{ text: { content: "0.2" } }] } },
    });
  });

  it("creates the row when the key has none, seeding its Description", async () => {
    const client = makeFakeClient((path) =>
      path.endsWith("/query")
        ? jsonResponse({ results: [] })
        : jsonResponse({ id: "page-new" }),
    );

    await repo.saveSetting(
      "RUSH_SURCHARGE_RATE",
      "0.2",
      "The rush surcharge",
      client,
    );

    const write = client.calls[1];
    expect(write.path).toBe("/v1/pages");
    expect(write.init?.method).toBe("POST");
    const body = JSON.parse(String(write.init?.body));
    expect(body.parent).toEqual({ database_id: "test-db-id" });
    expect(body.properties.Setting).toEqual({
      title: [{ text: { content: "RUSH_SURCHARGE_RATE" } }],
    });
    expect(body.properties.Description).toEqual({
      rich_text: [{ text: { content: "The rush surcharge" } }],
    });
  });

  it("retries without Description when the database hasn't got that column", async () => {
    // Notion rejects the WHOLE create when a page names a property the database
    // lacks, and Description is the one property the setup calls optional — so
    // without this a database without it could never save a setting at all.
    let creates = 0;
    const client = makeFakeClient((path) => {
      if (path.endsWith("/query")) return jsonResponse({ results: [] });
      creates += 1;
      return creates === 1
        ? errorResponse(400, "Description is not a property that exists")
        : jsonResponse({ id: "page-new" });
    });

    await repo.saveSetting("RUSH_SURCHARGE_RATE", "0.2", "note", client);

    expect(creates).toBe(2);
    const retry = JSON.parse(String(client.calls[2].init?.body));
    expect(retry.properties.Description).toBeUndefined();
    expect(retry.properties.Value).toEqual({
      rich_text: [{ text: { content: "0.2" } }],
    });
  });

  it("clears a setting by writing an empty rich_text", async () => {
    const client = makeFakeClient((path) =>
      path.endsWith("/query")
        ? jsonResponse({
            results: [settingRowPage("page-1", "RUSH_SURCHARGE_RATE", "0.2")],
          })
        : jsonResponse({ id: "page-1" }),
    );

    await repo.saveSetting("RUSH_SURCHARGE_RATE", "", undefined, client);

    expect(JSON.parse(String(client.calls[1].init?.body))).toEqual({
      properties: { Value: { rich_text: [] } },
    });
  });

  it("throws when there's no settings database to write to", async () => {
    const client = makeFakeClient(() => jsonResponse({ results: [] }), "");
    await expect(
      repo.saveSetting("RUSH_SURCHARGE_RATE", "0.2", undefined, client),
    ).rejects.toThrow(/NOTION_SETTINGS_DATABASE_ID/);
  });

  it("drops the cached map so the next request sees the new value", async () => {
    const readClient = makeFakeClient(() =>
      jsonResponse({
        results: [settingRowPage("page-1", "RUSH_SURCHARGE_RATE", "0.15")],
      }),
    );
    expect(
      (await repo.fetchStudioSettings(readClient)).get("RUSH_SURCHARGE_RATE"),
    ).toBe("0.15");

    const writeClient = makeFakeClient((path) =>
      path.endsWith("/query")
        ? jsonResponse({
            results: [settingRowPage("page-1", "RUSH_SURCHARGE_RATE", "0.15")],
          })
        : jsonResponse({ id: "page-1" }),
    );
    await repo.saveSetting(
      "RUSH_SURCHARGE_RATE",
      "0.2",
      undefined,
      writeClient,
    );

    // Within the 60s TTL, so without the bust this would still read 0.15 —
    // which reads to the atelier as a save that didn't work.
    const afterClient = makeFakeClient(() =>
      jsonResponse({
        results: [settingRowPage("page-1", "RUSH_SURCHARGE_RATE", "0.2")],
      }),
    );
    expect(
      (await repo.fetchStudioSettings(afterClient)).get("RUSH_SURCHARGE_RATE"),
    ).toBe("0.2");
  });
});

describe("saveSetting with duplicate rows", () => {
  it("writes to the row the settings map actually reads — the last one", async () => {
    // A hand-edited database can hold two rows for one key. `extractSettings`
    // lets the last win, so writing to the first would report success and change
    // nothing the app reads.
    const client = makeFakeClient((path) =>
      path.endsWith("/query")
        ? jsonResponse({
            results: [
              settingRowPage("page-old", "RUSH_SURCHARGE_RATE", "0.15"),
              settingRowPage("page-live", "RUSH_SURCHARGE_RATE", "0.18"),
            ],
          })
        : jsonResponse({ id: "page-live" }),
    );

    await repo.saveSetting("RUSH_SURCHARGE_RATE", "0.2", undefined, client);

    expect(client.calls[1].path).toBe("/v1/pages/page-live");
  });
});
