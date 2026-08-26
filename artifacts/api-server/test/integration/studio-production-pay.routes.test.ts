import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the two Notion adapters so the real service + route + auth stack runs
// without the network. The attribution itself is unit-tested separately.
vi.mock("../../src/lib/notion/work-distribution.repository.js", () => ({
  listWorkDistribution: vi.fn(),
  fetchLiveMakerRoster: vi.fn(),
  workDistributionConfigured: vi.fn(),
}));
vi.mock("../../src/lib/notion/pay-splits.repository.js", () => ({
  listPaySplits: vi.fn(),
  paySplitsConfigured: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import {
  listWorkDistribution,
  fetchLiveMakerRoster,
  workDistributionConfigured,
} from "../../src/lib/notion/work-distribution.repository.js";
import {
  listPaySplits,
  paySplitsConfigured,
} from "../../src/lib/notion/pay-splits.repository.js";
import type { WorkDistributionRecord } from "../../src/lib/notion/work-distribution.schema.js";
import type { PaySplitRecord } from "../../src/lib/notion/pay-splits.schema.js";
import { NotionRequestError } from "../../src/lib/notion/errors.js";
import {
  __setSupabaseClientForTests,
  __resetSupabaseClient,
} from "../../src/lib/supabase/client.js";
import {
  makeFakeSupabaseClient,
  asSupabaseClient,
  type FakeClaims,
} from "../support/fake-supabase.js";

const mockRows = vi.mocked(listWorkDistribution);
const mockRoster = vi.mocked(fetchLiveMakerRoster);
const mockSplits = vi.mocked(listPaySplits);
const mockWorkConfigured = vi.mocked(workDistributionConfigured);
const mockSplitsConfigured = vi.mocked(paySplitsConfigured);

const STAFF = "alexandra@a3iceanddance.com";
const GOOGLE_STAFF: FakeClaims = {
  email: STAFF,
  sub: "user-1",
  amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
};

const DRESS: PaySplitRecord = {
  id: "cat-dress",
  category: "Dress",
  shares: {
    consult: 0.15,
    sourcing: 0.1,
    cutting: 0.2,
    sewing: 0.35,
    detailing: 0.2,
  },
};

function row(
  overrides: Partial<WorkDistributionRecord> = {},
): WorkDistributionRecord {
  return {
    id: "work-1",
    item: "Knight of Midnight Dress",
    product: "",
    salePrice: 500,
    units: 1,
    categoryId: DRESS.id,
    orderStage: "Sewing/Construction",
    assignees: {
      consult: "Alexandra",
      sourcing: "Alayna",
      cutting: "Alayna",
      sewing: "Alexandra",
      detailing: "Alayna",
    },
    paid: {},
    notes: "",
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
  mockWorkConfigured.mockReturnValue(true);
  mockSplitsConfigured.mockReturnValue(true);
  mockRows.mockResolvedValue([row()]);
  mockSplits.mockResolvedValue([DRESS]);
  mockRoster.mockResolvedValue(["Alayna", "Alexandra"]);
  acceptToken("staff-token", GOOGLE_STAFF);
});

afterEach(() => {
  __resetSupabaseClient();
  delete process.env.STUDIO_STAFF_EMAILS;
  delete process.env.STUDIO_REQUIRE_GOOGLE;
});

describe("GET /api/studio/production-pay", () => {
  it("answers 401 without a Bearer token, and reads nothing", async () => {
    const response = await request(app).get("/api/studio/production-pay");

    expect(response.status).toBe(401);
    expect(mockRows).not.toHaveBeenCalled();
  });

  // Not-staff is answered as though the route doesn't exist — the same
  // indistinguishable-from-404 posture as the rest of the studio surface. It
  // matters more here than most: this is the studio's payroll.
  it("answers 404 for a signed-in customer", async () => {
    acceptToken("customer-token", {
      email: "someone@example.com",
      sub: "user-2",
      amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
    });

    const response = await request(app)
      .get("/api/studio/production-pay")
      .set("Authorization", "Bearer customer-token");

    expect(response.status).toBe(404);
    expect(mockRows).not.toHaveBeenCalled();
  });

  it("answers 403 for staff who didn't sign in with Google", async () => {
    acceptToken("password-token", {
      email: STAFF,
      sub: "user-1",
      amr: [{ method: "password", timestamp: 1_700_000_000 }],
    });

    const response = await request(app)
      .get("/api/studio/production-pay")
      .set("Authorization", "Bearer password-token");

    expect(response.status).toBe(403);
  });

  it("serves what each maker is owed, and what it is owed for", async () => {
    const response = await request(app)
      .get("/api/studio/production-pay")
      .set("Authorization", "Bearer staff-token");

    expect(response.status).toBe(200);
    expect(response.body.configured).toBe(true);
    expect(response.body.totalOwed).toBe(500);
    expect(response.body.makers).toEqual([
      expect.objectContaining({ maker: "Alayna", owed: 250, owedItems: 1 }),
      expect.objectContaining({ maker: "Alexandra", owed: 250, owedItems: 1 }),
    ]);
    expect(response.body.items[0]).toMatchObject({
      item: "Knight of Midnight Dress",
      category: "Dress",
      orderStage: "Sewing/Construction",
      value: 500,
    });
  });

  it("says which database is missing rather than reporting nothing owed", async () => {
    mockSplitsConfigured.mockReturnValue(false);

    const response = await request(app)
      .get("/api/studio/production-pay")
      .set("Authorization", "Bearer staff-token");

    expect(response.status).toBe(200);
    expect(response.body.configured).toBe(false);
    expect(response.body.missing).toEqual(["pay-splits"]);
    expect(response.body.makers).toEqual([]);
    expect(mockRows).not.toHaveBeenCalled();
  });

  // A 404 is the id being wrong or the integration never having been shared —
  // configuration a human has to clear, not an outage worth erroring the panel
  // over and alert-emailing on every dashboard load.
  it("reports a Notion 404 as unreachable rather than failing the panel", async () => {
    mockRows.mockRejectedValue(
      new NotionRequestError("not found", 404, "object_not_found"),
    );

    const response = await request(app)
      .get("/api/studio/production-pay")
      .set("Authorization", "Bearer staff-token");

    expect(response.status).toBe(200);
    expect(response.body.unreachable).toBe(true);
    expect(response.body.configured).toBe(true);
  });

  it("still answers when the maker roster can't be read", async () => {
    // The roster is best-effort: it only adds a nought row for a maker with no
    // work, so losing it must never cost anyone their pay.
    mockRoster.mockRejectedValue(new Error("schema read failed"));

    const response = await request(app)
      .get("/api/studio/production-pay")
      .set("Authorization", "Bearer staff-token");

    expect(response.status).toBe(200);
    expect(response.body.totalOwed).toBe(500);
    expect(response.body.makers.map((m: { maker: string }) => m.maker)).toEqual(
      ["Alayna", "Alexandra"],
    );
  });

  it("surfaces any other Notion failure as an error", async () => {
    mockRows.mockRejectedValue(
      new NotionRequestError("bad gateway", 502, "service_unavailable"),
    );

    const response = await request(app)
      .get("/api/studio/production-pay")
      .set("Authorization", "Bearer staff-token");

    expect(response.status).toBe(500);
  });
});
