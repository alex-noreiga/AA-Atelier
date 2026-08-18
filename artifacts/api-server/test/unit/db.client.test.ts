import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The client memoizes one pool and reads POSTGRES_URL at first use, so each test
// re-imports the module for a clean singleton and restores env. Constructing the
// porsager client does not open a connection (it connects lazily on first query),
// so these stay network-free.
let mod: typeof import("../../src/lib/db/client.js");
const saved = process.env.POSTGRES_URL;

beforeEach(async () => {
  vi.resetModules();
  mod = await import("../../src/lib/db/client.js");
});

afterEach(() => {
  if (saved === undefined) delete process.env.POSTGRES_URL;
  else process.env.POSTGRES_URL = saved;
});

describe("getDb", () => {
  it("throws when POSTGRES_URL is not set", () => {
    delete process.env.POSTGRES_URL;
    expect(() => mod.getDb()).toThrow(
      /POSTGRES_URL environment variable is not set/,
    );
  });

  it("constructs a client when set and memoizes it", () => {
    process.env.POSTGRES_URL = "postgres://u:p@localhost:6543/postgres";
    const first = mod.getDb();
    expect(first).toBeDefined();
    expect(mod.getDb()).toBe(first);
  });
});

describe("postgresConfigured", () => {
  it("reflects POSTGRES_URL presence", () => {
    process.env.POSTGRES_URL = "postgres://x";
    expect(mod.postgresConfigured()).toBe(true);
    delete process.env.POSTGRES_URL;
    expect(mod.postgresConfigured()).toBe(false);
  });
});
