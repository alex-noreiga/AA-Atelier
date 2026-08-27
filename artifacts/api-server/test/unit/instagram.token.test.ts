import { describe, it, expect, vi } from "vitest";
import {
  currentInstagramToken,
  refreshDue,
  refreshInstagramToken,
  seedFingerprint,
  storedTokenUsable,
  type InstagramTokenDeps,
} from "../../src/lib/instagram/token.js";
import type { StoredIntegrationToken } from "../../src/lib/db/integration-tokens.repository.js";

const SEED = "seed-token";
const NOW = new Date("2026-08-27T03:00:00.000Z");

function days(n: number): number {
  return n * 24 * 60 * 60 * 1000;
}

function stored(
  overrides: Partial<StoredIntegrationToken> = {},
): StoredIntegrationToken {
  return {
    accessToken: "stored-token",
    expiresAt: new Date(NOW.getTime() + days(59)),
    seedFingerprint: seedFingerprint(SEED),
    refreshedAt: new Date(NOW.getTime() - days(1)),
    ...overrides,
  };
}

/** A response double for the one endpoint this module calls. */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function deps(overrides: Partial<InstagramTokenDeps> = {}): InstagramTokenDeps {
  return {
    seedToken: SEED,
    storeConfigured: () => true,
    now: () => NOW,
    read: async () => null,
    write: async () => {},
    fetchImpl: async () =>
      jsonResponse({ access_token: "fresh", expires_in: 5184000 }),
    ...overrides,
  };
}

describe("storedTokenUsable", () => {
  it("accepts a live token from the current seed", () => {
    expect(storedTokenUsable(stored(), SEED, NOW)).toBe(true);
  });

  it("abandons the chain when the atelier pastes a different seed", () => {
    // Without this, replacing the env var would do nothing until the stored
    // chain expired weeks later — which reads as the fix not working.
    expect(storedTokenUsable(stored(), "a-new-token", NOW)).toBe(false);
  });

  it("rejects an expired token so the env seed takes over", () => {
    expect(
      storedTokenUsable(
        stored({ expiresAt: new Date(NOW.getTime() - days(1)) }),
        SEED,
        NOW,
      ),
    ).toBe(false);
  });

  it("treats an unknown expiry as usable, not as dead", () => {
    // It was written by a successful refresh, so the evidence says it works.
    expect(storedTokenUsable(stored({ expiresAt: null }), SEED, NOW)).toBe(
      true,
    );
  });

  it("rejects nothing stored and a blank token", () => {
    expect(storedTokenUsable(null, SEED, NOW)).toBe(false);
    expect(storedTokenUsable(stored({ accessToken: "" }), SEED, NOW)).toBe(
      false,
    );
  });
});

describe("refreshDue", () => {
  it("is due when nothing has been stored yet", () => {
    expect(refreshDue(null, NOW)).toBe(true);
  });

  it("is not due while the token is comfortably inside its 60 days", () => {
    expect(
      refreshDue(
        stored({ expiresAt: new Date(NOW.getTime() + days(40)) }),
        NOW,
      ),
    ).toBe(false);
  });

  it("is due inside the last fortnight", () => {
    expect(
      refreshDue(
        stored({ expiresAt: new Date(NOW.getTime() + days(10)) }),
        NOW,
      ),
    ).toBe(true);
  });

  it("refuses to refresh a token less than a day old", () => {
    // Instagram rejects it, so asking would turn a freshly-seeded studio's
    // first day into an alert about an entirely expected refusal.
    expect(
      refreshDue(
        stored({
          refreshedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
          expiresAt: new Date(NOW.getTime() + days(1)),
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("is due when the expiry is unknown", () => {
    expect(refreshDue(stored({ expiresAt: null }), NOW)).toBe(true);
  });
});

describe("currentInstagramToken", () => {
  it("is empty when Instagram is not configured", async () => {
    expect(await currentInstagramToken(deps({ seedToken: "" }))).toBe("");
  });

  it("uses the seed when there is no token store", async () => {
    expect(
      await currentInstagramToken(deps({ storeConfigured: () => false })),
    ).toBe(SEED);
  });

  it("prefers the stored token while it is usable", async () => {
    expect(
      await currentInstagramToken(deps({ read: async () => stored() })),
    ).toBe("stored-token");
  });

  it("falls back to the seed when the stored token has lapsed", async () => {
    // A studio whose refresh has been broken for two months is fixed by
    // pasting a fresh token into Vercel — no database surgery.
    const lapsed = stored({ expiresAt: new Date(NOW.getTime() - days(1)) });
    expect(
      await currentInstagramToken(deps({ read: async () => lapsed })),
    ).toBe(SEED);
  });

  it("falls back to the seed when the database is unreachable", async () => {
    expect(
      await currentInstagramToken(
        deps({
          read: async () => {
            throw new Error("no connection");
          },
        }),
      ),
    ).toBe(SEED);
  });
});

describe("refreshInstagramToken", () => {
  it("skips when Instagram is not configured", async () => {
    const result = await refreshInstagramToken(deps({ seedToken: "" }));
    expect(result.status).toBe("skipped");
  });

  it("skips — and says why — with nowhere to store the answer", async () => {
    const result = await refreshInstagramToken(
      deps({ storeConfigured: () => false }),
    );
    expect(result.status).toBe("skipped");
    expect(result.detail).toContain("POSTGRES_URL");
  });

  it("skips a token that is nowhere near expiring", async () => {
    const fetchImpl = vi.fn();
    const result = await refreshInstagramToken(
      deps({
        read: async () =>
          stored({ expiresAt: new Date(NOW.getTime() + days(40)) }),
        fetchImpl,
      }),
    );
    expect(result.status).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stores the fresh token with its expiry and the seed it grew from", async () => {
    const write = vi.fn(async () => {});
    const result = await refreshInstagramToken(deps({ write }));

    expect(result.status).toBe("refreshed");
    expect(write).toHaveBeenCalledWith({
      provider: "instagram",
      accessToken: "fresh",
      expiresAt: new Date(NOW.getTime() + 5184000 * 1000),
      seedFingerprint: seedFingerprint(SEED),
    });
  });

  it("refreshes the STORED token once a chain exists, not the seed", async () => {
    const fetchImpl = vi.fn(async (_url: string) =>
      jsonResponse({ access_token: "fresh", expires_in: 5184000 }),
    );
    await refreshInstagramToken(
      deps({
        read: async () =>
          stored({ expiresAt: new Date(NOW.getTime() + days(3)) }),
        fetchImpl,
      }),
    );
    expect(fetchImpl.mock.calls[0][0]).toContain("access_token=stored-token");
  });

  it("starts a new chain from a replaced seed", async () => {
    const fetchImpl = vi.fn(async (_url: string) =>
      jsonResponse({ access_token: "fresh", expires_in: 5184000 }),
    );
    await refreshInstagramToken(
      deps({
        read: async () =>
          stored({ seedFingerprint: seedFingerprint("old-seed") }),
        fetchImpl,
      }),
    );
    expect(fetchImpl.mock.calls[0][0]).toContain(`access_token=${SEED}`);
  });

  it("reports a refusal from Instagram without throwing", async () => {
    const result = await refreshInstagramToken(
      deps({ fetchImpl: async () => jsonResponse({}, false, 400) }),
    );
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("400");
  });

  it("reports an unreachable Instagram without throwing", async () => {
    const result = await refreshInstagramToken(
      deps({
        fetchImpl: async () => {
          throw new Error("socket hang up");
        },
      }),
    );
    expect(result.status).toBe("failed");
  });

  it("reports a response carrying no token", async () => {
    const write = vi.fn(async () => {});
    const result = await refreshInstagramToken(
      deps({ fetchImpl: async () => jsonResponse({ expires_in: 100 }), write }),
    );
    expect(result.status).toBe("failed");
    expect(write).not.toHaveBeenCalled();
  });

  it("reports a token it renewed but could not store", async () => {
    const result = await refreshInstagramToken(
      deps({
        write: async () => {
          throw new Error("db down");
        },
      }),
    );
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("could not store");
  });

  it("records a null expiry when Instagram does not say", async () => {
    const write = vi.fn(async () => {});
    await refreshInstagramToken(
      deps({
        fetchImpl: async () => jsonResponse({ access_token: "fresh" }),
        write,
      }),
    );
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: null }),
    );
  });
});
