import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Only the settings adapter is faked — the real service, route, contract parse
// and auth stack run, which is the point: the staffing the dashboard writes has
// to be the staffing the public booking catalog then reports.
vi.mock("../../src/lib/notion/settings.repository.js", () => ({
  fetchStudioSettings: vi.fn(),
  fetchSettingRows: vi.fn(),
  settingsConfigured: vi.fn(),
  saveSetting: vi.fn(),
  __resetSettingsCache: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import {
  fetchStudioSettings,
  settingsConfigured,
  saveSetting,
} from "../../src/lib/notion/settings.repository.js";
import { STAFF_ROUTING_KEY } from "../../src/lib/appointments/routing.js";
import {
  __setSupabaseClientForTests,
  __resetSupabaseClient,
} from "../../src/lib/supabase/client.js";
import {
  makeFakeSupabaseClient,
  asSupabaseClient,
  type FakeClaims,
} from "../support/fake-supabase.js";

const mockSettings = vi.mocked(fetchStudioSettings);
const mockConfigured = vi.mocked(settingsConfigured);
const mockSave = vi.mocked(saveSetting);

const STAFF = "alexandra@a3iceanddance.com";
const GOOGLE_STAFF: FakeClaims = {
  email: STAFF,
  sub: "user-1",
  amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
};

const BODY = { types: [{ id: "consultation", staff: ["Alexandra"] }] };

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

/** What the settings snapshot the prime middleware loads should hold. */
function stored(routing?: string): void {
  mockSettings.mockResolvedValue(
    new Map(routing ? [[STAFF_ROUTING_KEY, routing]] : []),
  );
}

const staffed = (
  body: { types: Array<{ id: string; staff: string[] }> },
  id: string,
) => body.types.find((type) => type.id === id)?.staff;

beforeEach(() => {
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-test-key";
  process.env.STUDIO_STAFF_EMAILS = STAFF;
  delete process.env.STUDIO_REQUIRE_GOOGLE;
  delete process.env[STAFF_ROUTING_KEY];
  stored();
  mockConfigured.mockReturnValue(true);
  mockSave.mockResolvedValue(undefined);
  acceptToken("staff-token", GOOGLE_STAFF);
});

afterEach(() => {
  __resetSupabaseClient();
  delete process.env.STUDIO_STAFF_EMAILS;
  delete process.env.STUDIO_REQUIRE_GOOGLE;
  delete process.env[STAFF_ROUTING_KEY];
});

describe("the staff gate applies to appointment staffing", () => {
  const cases: Array<[string, () => request.Test]> = [
    ["GET", () => request(app).get("/api/studio/appointment-staff")],
    ["PUT", () => request(app).put("/api/studio/appointment-staff").send(BODY)],
  ];

  it.each(cases)("%s answers 401 without a Bearer token", async (_, call) => {
    expect((await call()).status).toBe(401);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it.each(cases)(
    "%s answers 404 for a signed-in customer, like the rest of the dashboard",
    async (_, call) => {
      acceptToken("customer-token", {
        email: "skater@example.com",
        sub: "user-2",
        amr: ["oauth"],
      });
      const res = await call().set("Authorization", "Bearer customer-token");
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/studio|staff/i);
      expect(mockSave).not.toHaveBeenCalled();
    },
  );
});

describe("GET /api/studio/appointment-staff", () => {
  it("returns the catalog's staffing when nothing is stored", async () => {
    const res = await request(app)
      .get("/api/studio/appointment-staff")
      .set("Authorization", "Bearer staff-token");

    expect(res.status).toBe(200);
    expect(res.body.usingDefaults).toBe(true);
    expect(res.body.staff).toEqual(["Alexandra", "Alayna"]);
    expect(staffed(res.body, "consultation")).toEqual(["Alayna"]);
  });

  it("returns the stored override with the default beside it", async () => {
    stored("consultation: Alexandra");
    const res = await request(app)
      .get("/api/studio/appointment-staff")
      .set("Authorization", "Bearer staff-token");

    expect(res.body.usingDefaults).toBe(false);
    const consultation = res.body.types.find(
      (type: { id: string }) => type.id === "consultation",
    );
    expect(consultation).toMatchObject({
      staff: ["Alexandra"],
      defaultStaff: ["Alayna"],
      durationMinutes: 30,
    });
  });
});

describe("PUT /api/studio/appointment-staff", () => {
  it("saves the staffing and answers with it", async () => {
    const res = await request(app)
      .put("/api/studio/appointment-staff")
      .set("Authorization", "Bearer staff-token")
      .send(BODY);

    expect(res.status).toBe(200);
    expect(staffed(res.body, "consultation")).toEqual(["Alexandra"]);
    expect(mockSave).toHaveBeenCalledWith(
      STAFF_ROUTING_KEY,
      "consultation: Alexandra",
      expect.any(String),
    );
  });

  it("rejects an empty staff list at the contract boundary", async () => {
    const res = await request(app)
      .put("/api/studio/appointment-staff")
      .set("Authorization", "Bearer staff-token")
      .send({ types: [{ id: "consultation", staff: [] }] });

    expect(res.status).toBe(400);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("rejects a name the studio doesn't book, with a reason", async () => {
    const res = await request(app)
      .put("/api/studio/appointment-staff")
      .set("Authorization", "Bearer staff-token")
      .send({ types: [{ id: "fitting", staff: ["Marguerite"] }] });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/Marguerite/);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("answers 409 when there is no settings database to write to", async () => {
    mockConfigured.mockReturnValue(false);
    const res = await request(app)
      .put("/api/studio/appointment-staff")
      .set("Authorization", "Bearer staff-token")
      .send(BODY);

    expect(res.status).toBe(409);
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe("the staffing reaches the public booking catalog", () => {
  // The whole point of the panel: what the atelier saves is what a customer is
  // offered, and what the booking gate then enforces. `/appointments/options`
  // is anonymous, so this also proves the routing isn't studio-only state.
  it("serves the stored staffing on GET /api/appointments/options", async () => {
    stored("consultation: Alexandra, Alayna; fitting: Alayna");
    const res = await request(app).get("/api/appointments/options");

    expect(res.status).toBe(200);
    expect(staffed(res.body, "consultation")).toEqual(["Alexandra", "Alayna"]);
    expect(staffed(res.body, "fitting")).toEqual(["Alayna"]);
    // A type the value never mentioned keeps the catalog's staffing.
    expect(staffed(res.body, "general")).toEqual(["Alexandra", "Alayna"]);
  });

  it("refuses availability for a staff member no longer on the type", async () => {
    stored("fitting: Alayna");
    const res = await request(app).get("/api/appointments/availability").query({
      typeId: "fitting",
      location: "in-person",
      staff: "Alexandra",
      days: 1,
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/doesn't offer/i);
  });

  it("degrades to the catalog rather than unstaffing a type on a typo", async () => {
    stored("fitting: Alexandre");
    const res = await request(app).get("/api/appointments/options");
    expect(staffed(res.body, "fitting")).toEqual(["Alexandra", "Alayna"]);
  });
});
