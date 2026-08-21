import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Notion adapter so the real service + route + auth stack runs without
// the network. The mapping itself is unit-tested separately.
vi.mock("../../src/lib/notion/requests.repository.js", () => ({
  listOpenRequests: vi.fn(),
  listClosedRequests: vi.fn(),
  findRequestById: vi.fn(),
  setRequestStage: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import {
  listOpenRequests,
  listClosedRequests,
  findRequestById,
  setRequestStage,
} from "../../src/lib/notion/requests.repository.js";
import type { StudioRequestRecord } from "../../src/lib/notion/requests.schema.js";
import {
  __setSupabaseClientForTests,
  __resetSupabaseClient,
} from "../../src/lib/supabase/client.js";
import {
  makeFakeSupabaseClient,
  asSupabaseClient,
  type FakeClaims,
} from "../support/fake-supabase.js";

const mockOpen = vi.mocked(listOpenRequests);
const mockClosed = vi.mocked(listClosedRequests);
const mockFind = vi.mocked(findRequestById);
const mockSet = vi.mocked(setRequestStage);

const STAFF = "alexandra@a3iceanddance.com";
const GOOGLE_STAFF: FakeClaims = {
  email: STAFF,
  sub: "user-1",
  amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
};

function record(
  overrides: Partial<StudioRequestRecord> = {},
): StudioRequestRecord {
  return {
    id: "req-1",
    kind: "cancellation",
    rawType: "Cancellation",
    subject: "Cancellation: ORD-000002",
    email: "skater@example.com",
    message: "Cancellation requested for custom order ORD-000002.",
    orderNumber: "ORD-000002",
    state: "new",
    rawStage: "New",
    submittedAt: "2026-08-01T12:00:00.000Z",
    notionUrl: "https://notion.so/req-1",
    action: { tool: "cancellation-refund", orderNumber: "ORD-000002" },
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
  mockOpen.mockResolvedValue({ records: [record()], truncated: false });
  mockClosed.mockResolvedValue([]);
  mockFind.mockResolvedValue(record());
  mockSet.mockResolvedValue(record({ state: "closed" }));
  acceptToken("staff-token", GOOGLE_STAFF);
});

afterEach(() => {
  __resetSupabaseClient();
  delete process.env.STUDIO_STAFF_EMAILS;
  delete process.env.STUDIO_REQUIRE_GOOGLE;
});

// These rows carry a customer's name, email, phone number and what they asked
// for — like the review queue, this serves the personal data of someone who
// isn't the caller, so the gate matters more here than on the figures.
describe("the staff gate applies to the request queue", () => {
  const cases: Array<[string, () => request.Test]> = [
    ["GET", () => request(app).get("/api/studio/requests")],
    [
      "PUT",
      () =>
        request(app)
          .put("/api/studio/requests/req-1/state")
          .send({ state: "closed" }),
    ],
  ];

  it.each(cases)("%s answers 401 without a Bearer token", async (_, call) => {
    expect((await call()).status).toBe(401);
    expect(mockOpen).not.toHaveBeenCalled();
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
      expect(mockOpen).not.toHaveBeenCalled();
      expect(mockSet).not.toHaveBeenCalled();
    },
  );
});

describe("GET /api/studio/requests", () => {
  it("serves each open request with the action that will work it", async () => {
    const res = await request(app)
      .get("/api/studio/requests")
      .set("Authorization", "Bearer staff-token");

    expect(res.status).toBe(200);
    expect(res.body.open).toEqual([
      {
        id: "req-1",
        kind: "cancellation",
        rawType: "Cancellation",
        subject: "Cancellation: ORD-000002",
        email: "skater@example.com",
        message: "Cancellation requested for custom order ORD-000002.",
        orderNumber: "ORD-000002",
        state: "new",
        rawStage: "New",
        submittedAt: "2026-08-01T12:00:00.000Z",
        notionUrl: "https://notion.so/req-1",
        action: { tool: "cancellation-refund", orderNumber: "ORD-000002" },
      },
    ]);
    expect(res.body.closed).toEqual([]);
  });

  it("reports a partial read rather than looking complete", async () => {
    mockOpen.mockResolvedValue({ records: [record()], truncated: true });
    mockClosed.mockResolvedValue([record({ id: "done", state: "closed" })]);

    const res = await request(app)
      .get("/api/studio/requests")
      .set("Authorization", "Bearer staff-token");

    expect(res.body.truncated).toBe(true);
    expect(res.body.closed.map((r: { id: string }) => r.id)).toEqual(["done"]);
  });
});

describe("PUT /api/studio/requests/:requestId/state", () => {
  it("records the state", async () => {
    const res = await request(app)
      .put("/api/studio/requests/req-1/state")
      .set("Authorization", "Bearer staff-token")
      .send({ state: "closed" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "req-1", state: "closed" });
    expect(mockSet).toHaveBeenCalledWith("req-1", "closed");
  });

  it("rejects a state outside the contract at the boundary", async () => {
    const res = await request(app)
      .put("/api/studio/requests/req-1/state")
      .set("Authorization", "Bearer staff-token")
      .send({ state: "escalated" });

    expect(res.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("404s for a request that no longer exists", async () => {
    mockFind.mockResolvedValue(null);

    const res = await request(app)
      .put("/api/studio/requests/gone/state")
      .set("Authorization", "Bearer staff-token")
      .send({ state: "closed" });

    expect(res.status).toBe(404);
  });
});
