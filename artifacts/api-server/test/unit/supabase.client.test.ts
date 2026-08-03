import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The client memoises one Supabase instance and reads its URL + anon key at
// first use, so each test re-imports the module for a clean singleton and
// restores env.
let mod: typeof import("../../src/lib/supabase/client.js");
const saved = {
  url: process.env.SUPABASE_URL,
  anon: process.env.SUPABASE_ANON_KEY,
};

beforeEach(async () => {
  vi.resetModules();
  mod = await import("../../src/lib/supabase/client.js");
});

afterEach(() => {
  if (saved.url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = saved.url;
  if (saved.anon === undefined) delete process.env.SUPABASE_ANON_KEY;
  else process.env.SUPABASE_ANON_KEY = saved.anon;
});

describe("getSupabaseClient", () => {
  it("throws when SUPABASE_URL is not set", () => {
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_ANON_KEY = "anon";
    expect(() => mod.getSupabaseClient()).toThrow(
      /SUPABASE_URL environment variable is not set/,
    );
  });

  it("throws when SUPABASE_ANON_KEY is not set", () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    delete process.env.SUPABASE_ANON_KEY;
    expect(() => mod.getSupabaseClient()).toThrow(
      /SUPABASE_ANON_KEY environment variable is not set/,
    );
  });

  it("constructs a client when configured and memoises it", () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    const first = mod.getSupabaseClient();
    expect(first).toBeDefined();
    expect(mod.getSupabaseClient()).toBe(first);
  });
});

describe("supabaseConfigured", () => {
  it("is true only when both URL and anon key are set", () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    expect(mod.supabaseConfigured()).toBe(true);

    delete process.env.SUPABASE_ANON_KEY;
    expect(mod.supabaseConfigured()).toBe(false);

    delete process.env.SUPABASE_URL;
    expect(mod.supabaseConfigured()).toBe(false);
  });
});
