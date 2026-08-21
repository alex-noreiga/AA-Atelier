import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Notion adapter so the real service + route + auth stack runs without
// the network. The resolution rules themselves are unit-tested separately.
vi.mock("../../src/lib/notion/settings.repository.js", () => ({
  fetchSettingRows: vi.fn(),
  settingsConfigured: vi.fn(),
  saveSetting: vi.fn(),
  // The prime middleware runs on every request, so it needs a stub too.
  fetchStudioSettings: vi.fn(async () => new Map<string, string>()),
}));

import request from "supertest";
import app from "../../src/app.js";
import {
  fetchSettingRows,
  settingsConfigured,
  saveSetting,
} from "../../src/lib/notion/settings.repository.js";
import {
  __setSupabaseClientForTests,
  __resetSupabaseClient,
} from "../../src/lib/supabase/client.js";
import {
  makeFakeSupabaseClient,
  asSupabaseClient,
  type FakeClaims,
} from "../support/fake-supabase.js";

const mockRows = vi.mocked(fetchSettingRows);
const mockConfigured = vi.mocked(settingsConfigured);
const mockSave = vi.mocked(saveSetting);

const STAFF = "alexandra@a3iceanddance.com";
const GOOGLE_STAFF: FakeClaims = {
  email: STAFF,
  sub: "user-1",
  amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
};

function acceptToken(validToken: string, claims: FakeClaims): void {
  __setSupabaseClientForTests(
    asSupabaseClient(
      makeFakeSupabaseClient((token) =>
        token === validToken
          ? { data: { claims }, error: null }
          : { data: null, error: { message: "invalid token" } },
      ),
    ),
  );
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-test-key";
  process.env.STUDIO_STAFF_EMAILS = STAFF;
  delete process.env.STUDIO_REQUIRE_GOOGLE;
  delete process.env.RUSH_SURCHARGE_RATE;
  mockConfigured.mockReturnValue(true);
  mockRows.mockResolvedValue([]);
  mockSave.mockResolvedValue(undefined);
  acceptToken("staff-token", GOOGLE_STAFF);
});

afterEach(() => {
  __resetSupabaseClient();
  delete process.env.STUDIO_STAFF_EMAILS;
  delete process.env.STUDIO_REQUIRE_GOOGLE;
  delete process.env.RUSH_SURCHARGE_RATE;
});

describe("GET /api/studio/settings", () => {
  it("answers 401 without a Bearer token, and reads nothing", async () => {
    const response = await request(app).get("/api/studio/settings");
    expect(response.status).toBe(401);
    expect(mockRows).not.toHaveBeenCalled();
  });

  it("answers 404 for a signed-in customer", async () => {
    acceptToken("customer-token", {
      email: "someone@example.com",
      sub: "user-2",
      amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
    });
    const response = await request(app)
      .get("/api/studio/settings")
      .set("Authorization", "Bearer customer-token");
    expect(response.status).toBe(404);
    expect(mockRows).not.toHaveBeenCalled();
  });

  it("answers 403 for staff whose session wasn't established with Google", async () => {
    acceptToken("password-token", {
      email: STAFF,
      sub: "user-1",
      amr: [{ method: "password", timestamp: 1_700_000_000 }],
    });
    const response = await request(app)
      .get("/api/studio/settings")
      .set("Authorization", "Bearer password-token");
    expect(response.status).toBe(403);
    expect(mockRows).not.toHaveBeenCalled();
  });

  it("returns every setting with where its value came from", async () => {
    mockRows.mockResolvedValue([
      { pageId: "p1", key: "RUSH_SURCHARGE_RATE", value: "0.2" },
    ]);

    const response = await request(app)
      .get("/api/studio/settings")
      .set("Authorization", "Bearer staff-token");

    expect(response.status).toBe(200);
    expect(response.body.configured).toBe(true);
    const rush = response.body.settings.find(
      (setting: { key: string }) => setting.key === "RUSH_SURCHARGE_RATE",
    );
    expect(rush).toMatchObject({
      source: "notion",
      effectiveValue: "0.2",
      notionValue: "0.2",
      defaultValue: "0.15",
      kind: "number",
    });
  });

  it("names a configured value the app can't use, and the row that isn't a setting", async () => {
    mockRows.mockResolvedValue([
      { pageId: "p1", key: "RUSH_SURCHARGE_RATE", value: "fifteen percent" },
      { pageId: "p2", key: "APPOINTMENT_TIMEZON", value: "Europe/London" },
    ]);

    const response = await request(app)
      .get("/api/studio/settings")
      .set("Authorization", "Bearer staff-token");

    const rush = response.body.settings.find(
      (setting: { key: string }) => setting.key === "RUSH_SURCHARGE_RATE",
    );
    expect(rush.source).toBe("default");
    expect(rush.ignoredValue).toBe("fifteen percent");
    expect(response.body.unknownRows).toEqual([
      {
        key: "APPOINTMENT_TIMEZON",
        value: "Europe/London",
        suggestion: "APPOINTMENT_TIMEZONE",
      },
    ]);
  });

  it("reports an unconfigured database rather than an empty list", async () => {
    mockConfigured.mockReturnValue(false);
    const response = await request(app)
      .get("/api/studio/settings")
      .set("Authorization", "Bearer staff-token");
    expect(response.status).toBe(200);
    expect(response.body.configured).toBe(false);
    expect(response.body.settings.length).toBeGreaterThan(0);
  });
});

describe("PUT /api/studio/settings/:key", () => {
  it("answers 401 without a Bearer token, and writes nothing", async () => {
    const response = await request(app)
      .put("/api/studio/settings/RUSH_SURCHARGE_RATE")
      .send({ value: "0.2" });
    expect(response.status).toBe(401);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("saves a valid value", async () => {
    const response = await request(app)
      .put("/api/studio/settings/RUSH_SURCHARGE_RATE")
      .set("Authorization", "Bearer staff-token")
      .send({ value: "0.2" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      key: "RUSH_SURCHARGE_RATE",
      source: "notion",
      effectiveValue: "0.2",
    });
    expect(mockSave).toHaveBeenCalledWith(
      "RUSH_SURCHARGE_RATE",
      "0.2",
      expect.any(String),
    );
  });

  it("refuses a value the setting can't take, with the reason", async () => {
    const response = await request(app)
      .put("/api/studio/settings/RUSH_SURCHARGE_RATE")
      .set("Authorization", "Bearer staff-token")
      .send({ value: "15" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/between 0 and 1/);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("refuses a key the app doesn't read", async () => {
    const response = await request(app)
      .put("/api/studio/settings/STRIPE_SECRET_KEY")
      .set("Authorization", "Bearer staff-token")
      .send({ value: "sk_live_x" });

    expect(response.status).toBe(400);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("answers 409 when there's no settings database to write to", async () => {
    mockConfigured.mockReturnValue(false);
    const response = await request(app)
      .put("/api/studio/settings/RUSH_SURCHARGE_RATE")
      .set("Authorization", "Bearer staff-token")
      .send({ value: "0.2" });

    expect(response.status).toBe(409);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("clears a setting on a blank value", async () => {
    process.env.RUSH_SURCHARGE_RATE = "0.25";
    const response = await request(app)
      .put("/api/studio/settings/RUSH_SURCHARGE_RATE")
      .set("Authorization", "Bearer staff-token")
      .send({ value: "" });

    expect(response.status).toBe(200);
    expect(mockSave).toHaveBeenCalledWith(
      "RUSH_SURCHARGE_RATE",
      "",
      expect.any(String),
    );
    expect(response.body).toMatchObject({
      source: "environment",
      effectiveValue: "0.25",
    });
  });
});
