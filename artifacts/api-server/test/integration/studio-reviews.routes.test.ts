import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Notion adapter so the real service + route + auth stack runs without
// the network. The mapping itself is unit-tested separately.
vi.mock("../../src/lib/notion/reviews.repository.js", () => ({
  listReviewsForModeration: vi.fn(),
  findReviewById: vi.fn(),
  setReviewStatus: vi.fn(),
  listReviewPhotos: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import {
  listReviewsForModeration,
  findReviewById,
  setReviewStatus,
  listReviewPhotos,
} from "../../src/lib/notion/reviews.repository.js";
import type { StudioReviewRecord } from "../../src/lib/notion/reviews.schema.js";
import {
  __setSupabaseClientForTests,
  __resetSupabaseClient,
} from "../../src/lib/supabase/client.js";
import {
  makeFakeSupabaseClient,
  asSupabaseClient,
  type FakeClaims,
} from "../support/fake-supabase.js";

const mockList = vi.mocked(listReviewsForModeration);
const mockFind = vi.mocked(findReviewById);
const mockSet = vi.mocked(setReviewStatus);
const mockPhotos = vi.mocked(listReviewPhotos);

const STAFF = "alexandra@a3iceanddance.com";
const GOOGLE_STAFF: FakeClaims = {
  email: STAFF,
  sub: "user-1",
  amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
};

function record(
  overrides: Partial<StudioReviewRecord> = {},
): StudioReviewRecord {
  return {
    id: "rev-1",
    rating: 5,
    comment: "The fit was perfect.",
    customerName: "Ada L.",
    orderNumber: "000002",
    email: "ada@example.com",
    emailVerified: true,
    consentToPublish: true,
    status: "pending",
    rawStatus: "New",
    submittedAt: "2026-08-01T12:00:00.000Z",
    notionUrl: "https://notion.so/rev-1",
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
  mockList.mockResolvedValue({ records: [record()], truncated: false });
  mockFind.mockResolvedValue(record());
  mockSet.mockResolvedValue(record({ status: "published" }));
  mockPhotos.mockResolvedValue([]);
  acceptToken("staff-token", GOOGLE_STAFF);
});

afterEach(() => {
  __resetSupabaseClient();
  delete process.env.STUDIO_STAFF_EMAILS;
  delete process.env.STUDIO_REQUIRE_GOOGLE;
});

// A review is a real customer's words and email address, so the gate matters
// more here than on the figures: this is the one studio surface that serves
// personal data of someone who isn't the caller.
describe("the staff gate applies to the moderation surface", () => {
  const cases: Array<[string, () => request.Test]> = [
    ["GET", () => request(app).get("/api/studio/reviews")],
    [
      "PUT",
      () =>
        request(app)
          .put("/api/studio/reviews/rev-1/status")
          .send({ status: "published" }),
    ],
  ];

  it.each(cases)("%s answers 401 without a Bearer token", async (_, call) => {
    expect((await call()).status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
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
      expect(mockList).not.toHaveBeenCalled();
      expect(mockSet).not.toHaveBeenCalled();
    },
  );
});

describe("GET /api/studio/reviews", () => {
  it("returns the queue with everything a decision is made on", async () => {
    mockPhotos.mockResolvedValue(["https://notion/a.png"]);

    const res = await request(app)
      .get("/api/studio/reviews")
      .set("Authorization", "Bearer staff-token");

    expect(res.status).toBe(200);
    expect(res.body.pending).toEqual([
      {
        id: "rev-1",
        rating: 5,
        comment: "The fit was perfect.",
        customerName: "Ada L.",
        orderNumber: "000002",
        email: "ada@example.com",
        emailVerified: true,
        consentToPublish: true,
        status: "pending",
        rawStatus: "New",
        submittedAt: "2026-08-01T12:00:00.000Z",
        notionUrl: "https://notion.so/rev-1",
        photos: ["https://notion/a.png"],
      },
    ]);
    expect(res.body.decided).toEqual([]);
  });

  it("separates the already-decided reviews from the queue", async () => {
    mockList.mockResolvedValue({
      records: [
        record({ id: "shown", status: "published" }),
        record({ id: "waiting" }),
      ],
      truncated: true,
    });

    const res = await request(app)
      .get("/api/studio/reviews")
      .set("Authorization", "Bearer staff-token");

    expect(res.body.pending.map((r: { id: string }) => r.id)).toEqual([
      "waiting",
    ]);
    expect(res.body.decided.map((r: { id: string }) => r.id)).toEqual([
      "shown",
    ]);
    expect(res.body.truncated).toBe(true);
  });
});

describe("PUT /api/studio/reviews/:reviewId/status", () => {
  it("records the decision", async () => {
    const res = await request(app)
      .put("/api/studio/reviews/rev-1/status")
      .set("Authorization", "Bearer staff-token")
      .send({ status: "published" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "rev-1", status: "published" });
    expect(mockSet).toHaveBeenCalledWith("rev-1", "published");
  });

  it("rejects a status outside the contract at the boundary", async () => {
    const res = await request(app)
      .put("/api/studio/reviews/rev-1/status")
      .set("Authorization", "Bearer staff-token")
      .send({ status: "featured" });

    expect(res.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("409s rather than publishing a review the customer didn't consent to", async () => {
    mockFind.mockResolvedValue(record({ consentToPublish: false }));

    const res = await request(app)
      .put("/api/studio/reviews/rev-1/status")
      .set("Authorization", "Bearer staff-token")
      .send({ status: "published" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/didn't agree/);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("404s a review Notion no longer has", async () => {
    mockFind.mockResolvedValue(null);

    const res = await request(app)
      .put("/api/studio/reviews/gone/status")
      .set("Authorization", "Bearer staff-token")
      .send({ status: "rejected" });

    expect(res.status).toBe(404);
  });
});
