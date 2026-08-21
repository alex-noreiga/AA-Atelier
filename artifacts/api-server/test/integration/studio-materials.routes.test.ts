import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Notion adapter so the real service + route + auth stack runs without
// the network. The classification itself is unit-tested separately.
vi.mock("../../src/lib/notion/materials.repository.js", () => ({
  listMaterials: vi.fn(),
  materialsConfigured: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import {
  listMaterials,
  materialsConfigured,
} from "../../src/lib/notion/materials.repository.js";
import type { MaterialRecord } from "../../src/lib/notion/materials.schema.js";
import {
  __setSupabaseClientForTests,
  __resetSupabaseClient,
} from "../../src/lib/supabase/client.js";
import {
  makeFakeSupabaseClient,
  asSupabaseClient,
  type FakeClaims,
} from "../support/fake-supabase.js";

const mockList = vi.mocked(listMaterials);
const mockConfigured = vi.mocked(materialsConfigured);

const STAFF = "alexandra@a3iceanddance.com";
const GOOGLE_STAFF: FakeClaims = {
  email: STAFF,
  sub: "user-1",
  amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
};

function material(overrides: Partial<MaterialRecord> = {}): MaterialRecord {
  return {
    id: "mat-1",
    name: "Black Fleece",
    stockOnHand: 0.25,
    minimumStock: 0.5,
    alertsSuppressed: false,
    ...overrides,
  };
}

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
  mockConfigured.mockReturnValue(true);
  mockList.mockResolvedValue([material()]);
  acceptToken("staff-token", GOOGLE_STAFF);
});

afterEach(() => {
  __resetSupabaseClient();
  delete process.env.STUDIO_STAFF_EMAILS;
  delete process.env.STUDIO_REQUIRE_GOOGLE;
});

describe("GET /api/studio/materials", () => {
  it("answers 401 without a Bearer token, and reads nothing", async () => {
    const response = await request(app).get("/api/studio/materials");

    expect(response.status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
  });

  // Not-staff is answered as though the route doesn't exist — the same
  // indistinguishable-from-404 posture as the rest of the studio surface.
  it("answers 404 for a signed-in customer", async () => {
    acceptToken("customer-token", {
      email: "someone@example.com",
      sub: "user-2",
      amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
    });

    const response = await request(app)
      .get("/api/studio/materials")
      .set("Authorization", "Bearer customer-token");

    expect(response.status).toBe(404);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("answers 403 for staff whose session wasn't established with Google", async () => {
    acceptToken("password-token", {
      email: STAFF,
      sub: "user-1",
      amr: [{ method: "password", timestamp: 1_700_000_000 }],
    });

    const response = await request(app)
      .get("/api/studio/materials")
      .set("Authorization", "Bearer password-token");

    expect(response.status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("returns the low-stock list for a studio account", async () => {
    const response = await request(app)
      .get("/api/studio/materials")
      .set("Authorization", "Bearer staff-token");

    expect(response.status).toBe(200);
    expect(response.body.configured).toBe(true);
    expect(response.body.lowStock).toHaveLength(1);
    expect(response.body.lowStock[0]).toMatchObject({
      name: "Black Fleece",
      shortfall: 0.25,
    });
    expect(response.body.totalCount).toBe(1);
  });

  it("separates the materials that have no reorder point", async () => {
    mockList.mockResolvedValue([
      material(),
      material({ id: "b", name: "Tulle", minimumStock: null }),
    ]);

    const response = await request(app)
      .get("/api/studio/materials")
      .set("Authorization", "Bearer staff-token");

    expect(response.body.lowStock.map((m: { name: string }) => m.name)).toEqual(
      ["Black Fleece"],
    );
    // The stock it DOES have rides along — that's what the atelier needs to
    // pick a sensible reorder point for it.
    expect(response.body.untracked).toEqual([
      { id: "b", name: "Tulle", reason: "no-reorder-point", stockOnHand: 0.25 },
    ]);
  });

  // An unconfigured database must not 500 the dashboard, and must not render as
  // an empty list that reads as "nothing is low".
  it("reports configured:false rather than erroring when the database is unset", async () => {
    mockConfigured.mockReturnValue(false);

    const response = await request(app)
      .get("/api/studio/materials")
      .set("Authorization", "Bearer staff-token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      lowStock: [],
      untracked: [],
      suppressedCount: 0,
      totalCount: 0,
      configured: false,
    });
    expect(mockList).not.toHaveBeenCalled();
  });
});
