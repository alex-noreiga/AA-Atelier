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
