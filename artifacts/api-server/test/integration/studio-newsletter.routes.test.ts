import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/notion/requests.repository.js", () => ({
  listPendingNewsletterSignups: vi.fn(),
  listHandledNewsletterSignups: vi.fn(),
  findRequestById: vi.fn(),
  setRequestStage: vi.fn(),
  // The request queue shares this module; unused here but the mock must be total.
  listOpenRequests: vi.fn(),
  listClosedRequests: vi.fn(),
}));

vi.mock("../../src/lib/resend/audience.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/resend/audience.js")>();
  return {
    ...actual,
    audienceConfigured: vi.fn(),
    listAudienceContacts: vi.fn(),
    upsertAudienceContact: vi.fn(),
  };
});

import request from "supertest";
import app from "../../src/app.js";
import {
  listPendingNewsletterSignups,
  listHandledNewsletterSignups,
  findRequestById,
  setRequestStage,
} from "../../src/lib/notion/requests.repository.js";
import {
  audienceConfigured,
  listAudienceContacts,
  upsertAudienceContact,
} from "../../src/lib/resend/audience.js";
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

const mockPending = vi.mocked(listPendingNewsletterSignups);
const mockHandled = vi.mocked(listHandledNewsletterSignups);
const mockFind = vi.mocked(findRequestById);
const mockSetStage = vi.mocked(setRequestStage);
const mockConfigured = vi.mocked(audienceConfigured);
const mockAudience = vi.mocked(listAudienceContacts);
const mockUpsert = vi.mocked(upsertAudienceContact);

const STAFF = "alexandra@a3iceanddance.com";
const GOOGLE_STAFF: FakeClaims = {
  email: STAFF,
  sub: "user-1",
  amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
};

function row(
  overrides: Partial<StudioRequestRecord> = {},
): StudioRequestRecord {
  return {
    id: "sign-1",
    kind: "newsletter",
    subject: "Newsletter opt-in — footer",
    email: "skater@example.com",
    state: "new",
    submittedAt: "2026-08-01T12:00:00.000Z",
    notionUrl: "https://notion.so/sign-1",
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
  mockPending.mockResolvedValue({
    records: [
      {
        id: "sign-1",
        email: "skater@example.com",
        source: "footer",
        subject: "Newsletter opt-in — footer",
        state: "new",
        submittedAt: "2026-08-01T12:00:00.000Z",
        notionUrl: "https://notion.so/sign-1",
      },
    ],
    truncated: false,
  });
  mockHandled.mockResolvedValue([]);
  mockConfigured.mockReturnValue(true);
  mockAudience.mockResolvedValue({ contacts: new Map(), total: 0 });
  mockUpsert.mockResolvedValue(undefined);
  mockFind.mockResolvedValue(row());
  mockSetStage.mockResolvedValue(row({ state: "closed" }));
  acceptToken("staff-token", GOOGLE_STAFF);
});

afterEach(() => {
  __resetSupabaseClient();
  delete process.env.STUDIO_STAFF_EMAILS;
  delete process.env.STUDIO_REQUIRE_GOOGLE;
});

// These rows are customers' email addresses and a record of their marketing
// consent — the same reason the gate matters on the review and request queues.
describe("the staff gate applies to the newsletter panel", () => {
  const cases: Array<[string, () => request.Test]> = [
    ["GET", () => request(app).get("/api/studio/newsletter")],
    [
      "POST",
      () => request(app).post("/api/studio/newsletter/sign-1/subscribe"),
    ],
  ];

  it.each(cases)("%s answers 401 without a Bearer token", async (_, call) => {
    expect((await call()).status).toBe(401);
    expect(mockPending).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it.each(cases)(
    "%s answers 404 for a signed-in customer, like the rest of the dashboard",
    async (_, call) => {
      acceptToken("customer-token", {
        email: "skater@example.com",
        sub: "user-2",
        amr: ["oauth"],
      });
      expect(
        (await call().set("Authorization", "Bearer customer-token")).status,
      ).toBe(404);
      expect(mockUpsert).not.toHaveBeenCalled();
    },
  );
});

describe("GET /api/studio/newsletter", () => {
  it("serves each opt-in with its live audience status", async () => {
    const res = await request(app)
      .get("/api/studio/newsletter")
      .set("Authorization", "Bearer staff-token");

    expect(res.status).toBe(200);
    expect(res.body.pending).toEqual([
      {
        id: "sign-1",
        email: "skater@example.com",
        source: "footer",
        subject: "Newsletter opt-in — footer",
        state: "new",
        subscription: "absent",
        submittedAt: "2026-08-01T12:00:00.000Z",
        notionUrl: "https://notion.so/sign-1",
      },
    ]);
    expect(res.body.audience).toEqual({ configured: true, contactCount: 0 });
  });

  it("says the audience is unreachable rather than reporting nobody subscribed", async () => {
    mockAudience.mockRejectedValue(new Error("Resend is down"));

    const res = await request(app)
      .get("/api/studio/newsletter")
      .set("Authorization", "Bearer staff-token");

    expect(res.body.pending[0].subscription).toBe("unknown");
    expect(res.body.audience).toEqual({ configured: true, unreachable: true });
  });
});

describe("POST /api/studio/newsletter/:signupId/subscribe", () => {
  it("adds the contact and files the row away", async () => {
    const res = await request(app)
      .post("/api/studio/newsletter/sign-1/subscribe")
      .set("Authorization", "Bearer staff-token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "sign-1",
      state: "closed",
      subscription: "subscribed",
    });
    expect(mockUpsert).toHaveBeenCalledWith("skater@example.com");
    expect(mockSetStage).toHaveBeenCalledWith("sign-1", "closed");
  });

  it("409s rather than re-subscribing someone who opted out", async () => {
    mockAudience.mockResolvedValue({
      contacts: new Map([["skater@example.com", true]]),
      total: 1,
    });

    const res = await request(app)
      .post("/api/studio/newsletter/sign-1/subscribe")
      .set("Authorization", "Bearer staff-token");

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/unsubscribed/i);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("409s when no audience is configured, leaving the row open", async () => {
    mockConfigured.mockReturnValue(false);

    const res = await request(app)
      .post("/api/studio/newsletter/sign-1/subscribe")
      .set("Authorization", "Bearer staff-token");

    expect(res.status).toBe(409);
    expect(mockSetStage).not.toHaveBeenCalled();
  });

  it("404s for an opt-in that no longer exists", async () => {
    mockFind.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/studio/newsletter/gone/subscribe")
      .set("Authorization", "Bearer staff-token");

    expect(res.status).toBe(404);
  });
});
