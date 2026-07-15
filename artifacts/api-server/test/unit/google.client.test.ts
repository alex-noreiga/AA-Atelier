import { describe, it, expect, beforeEach, afterEach } from "vitest";

// `client.ts` reads GOOGLE_SERVICE_ACCOUNT_KEY at first use and caches the
// constructed client at module scope, so each test resets the module graph and
// re-imports to get a fresh, un-cached factory. The validation (`readService-
// AccountKey`) is what a misconfigured deploy hits first, and it's the seam the
// calendar/sheets repositories never exercise (they inject a fake client).

const VALID_KEY = JSON.stringify({
  client_email: "sa@project.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
});

const originalKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

async function importClient() {
  const { vi } = await import("vitest");
  vi.resetModules();
  return import("../../src/lib/google/client.js");
}

beforeEach(() => {
  delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  else process.env.GOOGLE_SERVICE_ACCOUNT_KEY = originalKey;
});

describe("getGoogleCalendarClient", () => {
  it("throws when GOOGLE_SERVICE_ACCOUNT_KEY is not set", async () => {
    const { getGoogleCalendarClient } = await importClient();
    expect(() => getGoogleCalendarClient()).toThrow(
      /GOOGLE_SERVICE_ACCOUNT_KEY environment variable is not set/,
    );
  });

  it("throws when the key isn't valid JSON", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = "{not json";
    const { getGoogleCalendarClient } = await importClient();
    expect(() => getGoogleCalendarClient()).toThrow(/not valid JSON/);
  });

  it("throws when the key is missing client_email", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify({
      private_key: "pk",
    });
    const { getGoogleCalendarClient } = await importClient();
    expect(() => getGoogleCalendarClient()).toThrow(
      /missing client_email or private_key/,
    );
  });

  it("throws when the key is missing private_key", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify({
      client_email: "sa@project.iam.gserviceaccount.com",
    });
    const { getGoogleCalendarClient } = await importClient();
    expect(() => getGoogleCalendarClient()).toThrow(
      /missing client_email or private_key/,
    );
  });

  it("constructs a client with a fetch method for a valid key, and caches it", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = VALID_KEY;
    const { getGoogleCalendarClient } = await importClient();

    const client = getGoogleCalendarClient();
    expect(typeof client.fetch).toBe("function");
    // Second call returns the same cached instance (no re-parse of the key).
    expect(getGoogleCalendarClient()).toBe(client);
  });
});

describe("getGoogleSheetsClient", () => {
  it("throws when GOOGLE_SERVICE_ACCOUNT_KEY is not set", async () => {
    const { getGoogleSheetsClient } = await importClient();
    expect(() => getGoogleSheetsClient()).toThrow(
      /GOOGLE_SERVICE_ACCOUNT_KEY environment variable is not set/,
    );
  });

  it("throws when the key is missing private_key", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify({
      client_email: "sa@project.iam.gserviceaccount.com",
    });
    const { getGoogleSheetsClient } = await importClient();
    expect(() => getGoogleSheetsClient()).toThrow(
      /missing client_email or private_key/,
    );
  });

  it("constructs a client with a fetch method for a valid key, and caches it", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = VALID_KEY;
    const { getGoogleSheetsClient } = await importClient();

    const client = getGoogleSheetsClient();
    expect(typeof client.fetch).toBe("function");
    expect(getGoogleSheetsClient()).toBe(client);
  });
});
