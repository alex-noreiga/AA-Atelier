import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Notion adapter so the real service + route + auth stack runs without
// the network. The mapping itself is unit-tested separately.
vi.mock("../../src/lib/db/staff-availability.repository.js", () => ({
  listStaffAvailability: vi.fn(),
  createStaffAvailability: vi.fn(),
  updateStaffAvailability: vi.fn(),
  deleteStaffAvailability: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import {
  listStaffAvailability,
  createStaffAvailability,
  updateStaffAvailability,
  deleteStaffAvailability,
} from "../../src/lib/db/staff-availability.repository.js";
import {
  __setSupabaseClientForTests,
  __resetSupabaseClient,
} from "../../src/lib/supabase/client.js";
import {
  makeFakeSupabaseClient,
  asSupabaseClient,
  type FakeClaims,
} from "../support/fake-supabase.js";

const mockList = vi.mocked(listStaffAvailability);
const mockCreate = vi.mocked(createStaffAvailability);
const mockUpdate = vi.mocked(updateStaffAvailability);
const mockDelete = vi.mocked(deleteStaffAvailability);

const STAFF = "alexandra@a3iceanddance.com";
const GOOGLE_STAFF: FakeClaims = {
  email: STAFF,
  sub: "user-1",
  amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
};

const BODY = {
  staff: "Alexandra",
  calendarEmail: "alexandra@atelier.test",
  weekdays: ["Monday", "Wednesday"],
  start: "10:00",
  end: "17:00",
  locations: ["in-person"],
};

const ROW = {
  id: "row-1",
  staff: "Alexandra",
  email: "alexandra@atelier.test",
  weekdays: ["Monday", "Wednesday"],
  start: "10:00",
  end: "17:00",
  locations: ["In person"],
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
  mockList.mockResolvedValue([ROW]);
  mockCreate.mockResolvedValue(ROW);
  mockUpdate.mockResolvedValue(ROW);
  mockDelete.mockResolvedValue(true);
  acceptToken("staff-token", GOOGLE_STAFF);
});

afterEach(() => {
  __resetSupabaseClient();
  delete process.env.STUDIO_STAFF_EMAILS;
  delete process.env.STUDIO_REQUIRE_GOOGLE;
});

describe("the staff gate applies to the whole schedule surface", () => {
  const cases: Array<[string, () => request.Test]> = [
    ["GET", () => request(app).get("/api/studio/availability")],
    ["POST", () => request(app).post("/api/studio/availability").send(BODY)],
    [
      "PUT",
      () => request(app).put("/api/studio/availability/row-1").send(BODY),
    ],
    ["DELETE", () => request(app).delete("/api/studio/availability/row-1")],
  ];

  it.each(cases)("%s answers 401 without a Bearer token", async (_, call) => {
    expect((await call()).status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
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
      expect(JSON.stringify(res.body)).not.toMatch(/studio|staff|hours/i);
    },
  );
});

describe("GET /api/studio/availability", () => {
  it("returns the schedule plus the staff it may be assigned to", async () => {
    const res = await request(app)
      .get("/api/studio/availability")
      .set("Authorization", "Bearer staff-token");

    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([
      {
        id: "row-1",
        staff: "Alexandra",
        calendarEmail: "alexandra@atelier.test",
        weekdays: ["Monday", "Wednesday"],
        start: "10:00",
        end: "17:00",
        locations: ["in-person"],
      },
    ]);
    expect(res.body.staff).toEqual(["Alayna", "Alexandra"]);
  });
});

describe("POST /api/studio/availability", () => {
  it("stores a new block of hours", async () => {
    const res = await request(app)
      .post("/api/studio/availability")
      .set("Authorization", "Bearer staff-token")
      .send(BODY);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "row-1", staff: "Alexandra" });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ staff: "Alexandra", start: "10:00" }),
    );
  });

  it("rejects a malformed time at the contract boundary", async () => {
    const res = await request(app)
      .post("/api/studio/availability")
      .set("Authorization", "Bearer staff-token")
      .send({ ...BODY, start: "half ten" });

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects hours that end before they start, with a reason", async () => {
    const res = await request(app)
      .post("/api/studio/availability")
      .set("Authorization", "Bearer staff-token")
      .send({ ...BODY, start: "17:00", end: "10:00" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/after the start time/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a staff member the studio doesn't book", async () => {
    const res = await request(app)
      .post("/api/studio/availability")
      .set("Authorization", "Bearer staff-token")
      .send({ ...BODY, staff: "Someone Else" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/isn't someone the studio books/);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("PUT /api/studio/availability/:entryId", () => {
  it("replaces the entry", async () => {
    const res = await request(app)
      .put("/api/studio/availability/row-1")
      .set("Authorization", "Bearer staff-token")
      .send(BODY);

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith("row-1", expect.anything());
  });

  it("answers 404 when the row was deleted in the meantime", async () => {
    mockUpdate.mockResolvedValue(null);
    const res = await request(app)
      .put("/api/studio/availability/row-gone")
      .set("Authorization", "Bearer staff-token")
      .send(BODY);

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/studio/availability/:entryId", () => {
  it("removes the entry", async () => {
    const res = await request(app)
      .delete("/api/studio/availability/row-1")
      .set("Authorization", "Bearer staff-token");

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/removed from the schedule/);
    expect(mockDelete).toHaveBeenCalledWith("row-1");
  });

  it("answers 404 when the row is already gone", async () => {
    mockDelete.mockResolvedValue(false);
    const res = await request(app)
      .delete("/api/studio/availability/row-gone")
      .set("Authorization", "Bearer staff-token");

    expect(res.status).toBe(404);
  });
});
