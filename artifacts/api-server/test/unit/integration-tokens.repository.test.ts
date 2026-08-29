import { describe, it, expect } from "vitest";
import { makeFakeDb } from "../support/fake-db.js";
import {
  readIntegrationToken,
  writeIntegrationToken,
} from "../../src/lib/db/integration-tokens.repository.js";

describe("readIntegrationToken", () => {
  it("returns null when nothing has been stored", async () => {
    const db = makeFakeDb(() => []);
    expect(await readIntegrationToken("instagram", db)).toBeNull();
  });

  it("maps a row, keyed on the provider it was asked for", async () => {
    const db = makeFakeDb(() => [
      {
        access_token: "tok",
        expires_at: new Date("2026-10-01T00:00:00.000Z"),
        seed_fingerprint: "abc",
        refreshed_at: new Date("2026-08-01T00:00:00.000Z"),
      },
    ]);

    const stored = await readIntegrationToken("instagram", db);

    expect(stored).toEqual({
      accessToken: "tok",
      expiresAt: new Date("2026-10-01T00:00:00.000Z"),
      seedFingerprint: "abc",
      refreshedAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(db.calls[0].params).toEqual(["instagram"]);
  });

  it("accepts ISO text where a driver hands back strings", async () => {
    const db = makeFakeDb(() => [
      {
        access_token: "tok",
        expires_at: "2026-10-01T00:00:00.000Z",
        seed_fingerprint: null,
        refreshed_at: "2026-08-01T00:00:00.000Z",
      },
    ]);

    const stored = await readIntegrationToken("instagram", db);

    expect(stored?.expiresAt).toEqual(new Date("2026-10-01T00:00:00.000Z"));
    expect(stored?.refreshedAt).toEqual(new Date("2026-08-01T00:00:00.000Z"));
  });

  it("reads an absent expiry as unknown rather than as a date", async () => {
    const db = makeFakeDb(() => [
      {
        access_token: "tok",
        expires_at: null,
        seed_fingerprint: null,
        refreshed_at: new Date("2026-08-01T00:00:00.000Z"),
      },
    ]);
    expect((await readIntegrationToken("instagram", db))?.expiresAt).toBeNull();
  });
});

describe("writeIntegrationToken", () => {
  it("upserts, so a provider only ever holds its current token", async () => {
    // Keeping the history would be keeping expired credentials.
    const db = makeFakeDb(() => []);
    const expiresAt = new Date("2026-10-01T00:00:00.000Z");

    await writeIntegrationToken(
      {
        provider: "instagram",
        accessToken: "fresh",
        expiresAt,
        seedFingerprint: "abc",
      },
      db,
    );

    expect(db.calls[0].text).toContain("on conflict (provider) do update");
    expect(db.calls[0].params).toEqual([
      "instagram",
      "fresh",
      expiresAt,
      "abc",
    ]);
  });
});
