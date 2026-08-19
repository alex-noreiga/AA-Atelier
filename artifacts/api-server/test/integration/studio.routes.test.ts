import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Notion scans so the real service + route + auth stack runs without
// the network — the aggregation itself is unit-tested separately.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  listOrdersForAnalytics: vi.fn().mockResolvedValue({
    orders: [],
    stages: ["Consultation", "Delivered"],
  }),
}));
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  listShopOrdersForAnalytics: vi
    .fn()
    .mockResolvedValue({ orders: [], statuses: ["Shipped"] }),
}));
vi.mock("../../src/lib/notion/invoice.repository.js", () => ({
  listInvoicesForAnalytics: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/lib/notion/products.repository.js", () => ({
  listVariants: vi.fn().mockResolvedValue([]),
}));

import request from "supertest";
import app from "../../src/app.js";
import { listOrdersForAnalytics } from "../../src/lib/notion/orders.repository.js";
import { listShopOrdersForAnalytics } from "../../src/lib/notion/shop-orders.repository.js";
import { listInvoicesForAnalytics } from "../../src/lib/notion/invoice.repository.js";
import { __resetStudioAnalyticsCache } from "../../src/services/studio-analytics.service.js";
import {
  __setSupabaseClientForTests,
  __resetSupabaseClient,
} from "../../src/lib/supabase/client.js";
import {
  makeFakeSupabaseClient,
  asSupabaseClient,
  type FakeClaims,
} from "../support/fake-supabase.js";

const mockOrders = vi.mocked(listOrdersForAnalytics);
const mockShop = vi.mocked(listShopOrdersForAnalytics);
const mockInvoices = vi.mocked(listInvoicesForAnalytics);

const STAFF = "alexandra@a3iceanddance.com";
/** Claims for a staff member who signed in with Google — what the gate wants.
 * `amr` is what Supabase stamps with how THIS session was established. */
const GOOGLE_STAFF: FakeClaims = {
  email: STAFF,
  sub: "user-1",
  amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
};

/** Inject a fake that accepts one specific token and returns the given claims. */
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
  delete process.env.STUDIO_REQUIRE_GOOGLE; // the default (required) is the norm
  // The service caches its aggregation for a minute; each test starts clean.
  __resetStudioAnalyticsCache();
  mockOrders.mockResolvedValue({
    orders: [],
    stages: ["Consultation", "Delivered"],
  });
  mockShop.mockResolvedValue({ orders: [], statuses: ["Shipped"] });
  mockInvoices.mockResolvedValue([]);
});

afterEach(() => {
  __resetSupabaseClient();
  delete process.env.STUDIO_STAFF_EMAILS;
  delete process.env.STUDIO_REQUIRE_GOOGLE;
});

describe("GET /api/studio/analytics", () => {
  it("returns 401 without a Bearer token", async () => {
    acceptToken("good-token", GOOGLE_STAFF);
    const res = await request(app).get("/api/studio/analytics");
    expect(res.status).toBe(401);
    expect(mockOrders).not.toHaveBeenCalled();
  });

  it("returns 401 for a token Supabase rejects", async () => {
    acceptToken("good-token", GOOGLE_STAFF);
    const res = await request(app)
      .get("/api/studio/analytics")
      .set("Authorization", "Bearer stale-token");
    expect(res.status).toBe(401);
    expect(mockOrders).not.toHaveBeenCalled();
  });

  it("returns 403 for a signed-in customer who isn't studio staff", async () => {
    acceptToken("customer-token", {
      email: "skater@example.com",
      sub: "user-2",
      amr: ["oauth"],
    });
    const res = await request(app)
      .get("/api/studio/analytics")
      .set("Authorization", "Bearer customer-token");

    expect(res.status).toBe(403);
    expect(mockOrders).not.toHaveBeenCalled();
  });

  it("returns 403 for everyone when no allowlist is configured", async () => {
    delete process.env.STUDIO_STAFF_EMAILS;
    acceptToken("staff-token", GOOGLE_STAFF);

    const res = await request(app)
      .get("/api/studio/analytics")
      .set("Authorization", "Bearer staff-token");

    expect(res.status).toBe(403);
    expect(mockOrders).not.toHaveBeenCalled();
  });

  it("returns the studio figures for a staff account", async () => {
    mockOrders.mockResolvedValue({
      orders: [
        {
          pageId: "page-1",
          orderNumber: "ORD-1",
          orderName: "Aurora",
          stage: "Consultation",
          createdTime: new Date().toISOString(),
          dueDate: "2099-01-01",
          cancelled: false,
          rush: true,
          invoicePageId: "inv-1",
        },
      ],
      stages: ["Consultation", "Delivered"],
    });
    mockInvoices.mockResolvedValue([
      {
        pageId: "inv-1",
        orderPageId: "page-1",
        finalBalance: 1000,
        depositsPaid: 250,
        depositsUnpaid: 0,
        balancePaid: false,
      },
    ]);
    acceptToken("staff-token", GOOGLE_STAFF);

    const res = await request(app)
      .get("/api/studio/analytics")
      .set("Authorization", "Bearer staff-token");

    expect(res.status).toBe(200);
    expect(res.body.customOrders).toMatchObject({ total: 1, active: 1 });
    expect(res.body.production).toMatchObject({ activeOrders: 1, rush: 1 });
    expect(res.body.payments).toMatchObject({
      invoicedTotal: 1000,
      depositsCollected: 250,
      outstandingTotal: 750,
    });
    expect(res.body.revenue).toHaveLength(12);
    expect(res.body.topItems).toEqual([]);
    expect(typeof res.body.generatedAt).toBe("string");
  });

  it("matches the allowlist on the canonical email", async () => {
    process.env.STUDIO_STAFF_EMAILS = "Alexandra@A3IceAndDance.com";
    acceptToken("staff-token", {
      ...GOOGLE_STAFF,
      email: "ALEXANDRA@a3iceanddance.com",
    });

    const res = await request(app)
      .get("/api/studio/analytics")
      .set("Authorization", "Bearer staff-token");

    expect(res.status).toBe(200);
  });
});

describe("GET /api/studio/analytics — sign-in method", () => {
  it("refuses a staff address whose session came from a password", async () => {
    acceptToken("password-token", {
      email: STAFF,
      sub: "user-1",
      amr: [{ method: "password", timestamp: 1_700_000_000 }],
    });

    const res = await request(app)
      .get("/api/studio/analytics")
      .set("Authorization", "Bearer password-token");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Google/);
    expect(mockOrders).not.toHaveBeenCalled();
  });

  it("refuses a staff address whose session came from a magic link", async () => {
    acceptToken("magic-token", {
      email: STAFF,
      sub: "user-1",
      amr: ["magiclink"],
    });

    const res = await request(app)
      .get("/api/studio/analytics")
      .set("Authorization", "Bearer magic-token");

    expect(res.status).toBe(403);
    expect(mockOrders).not.toHaveBeenCalled();
  });

  it("fails closed when the token records no sign-in method at all", async () => {
    acceptToken("no-amr-token", { email: STAFF, sub: "user-1" });

    const res = await request(app)
      .get("/api/studio/analytics")
      .set("Authorization", "Bearer no-amr-token");

    expect(res.status).toBe(403);
  });

  it("accepts the RFC-8176 string form of the claim", async () => {
    acceptToken("oauth-token", {
      email: STAFF,
      sub: "user-1",
      amr: ["oauth"],
    });

    const res = await request(app)
      .get("/api/studio/analytics")
      .set("Authorization", "Bearer oauth-token");

    expect(res.status).toBe(200);
  });

  it("allows a password session when the requirement is switched off", async () => {
    process.env.STUDIO_REQUIRE_GOOGLE = "false";
    acceptToken("password-token", {
      email: STAFF,
      sub: "user-1",
      amr: ["password"],
    });

    const res = await request(app)
      .get("/api/studio/analytics")
      .set("Authorization", "Bearer password-token");

    expect(res.status).toBe(200);
  });

  it("still refuses a non-staff address with the requirement switched off", async () => {
    process.env.STUDIO_REQUIRE_GOOGLE = "false";
    acceptToken("customer-token", {
      email: "skater@example.com",
      sub: "user-2",
      amr: ["oauth"],
    });

    const res = await request(app)
      .get("/api/studio/analytics")
      .set("Authorization", "Bearer customer-token");

    expect(res.status).toBe(403);
    expect(res.body.error).not.toMatch(/Google/);
  });
});

// The probe behind the navbar's staff-only link. What matters is that it agrees
// with the figures route on every input — offering the link to someone the
// dashboard would refuse is the whole failure mode — and that answering costs
// nothing, since the navbar asks on every signed-in session.
describe("GET /api/studio/access", () => {
  it("returns 401 without a Bearer token", async () => {
    acceptToken("good-token", GOOGLE_STAFF);
    const res = await request(app).get("/api/studio/access");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a signed-in customer who isn't studio staff", async () => {
    acceptToken("customer-token", {
      email: "skater@example.com",
      sub: "user-2",
      amr: ["oauth"],
    });

    const res = await request(app)
      .get("/api/studio/access")
      .set("Authorization", "Bearer customer-token");

    expect(res.status).toBe(403);
  });

  it("returns 403 for everyone when no allowlist is configured", async () => {
    delete process.env.STUDIO_STAFF_EMAILS;
    acceptToken("staff-token", GOOGLE_STAFF);

    const res = await request(app)
      .get("/api/studio/access")
      .set("Authorization", "Bearer staff-token");

    expect(res.status).toBe(403);
  });

  it("refuses a staff address whose session didn't come through Google", async () => {
    acceptToken("password-token", {
      email: STAFF,
      sub: "user-1",
      amr: ["password"],
    });

    const res = await request(app)
      .get("/api/studio/access")
      .set("Authorization", "Bearer password-token");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Google/);
  });

  it("confirms access for a staff account, without reading Notion", async () => {
    acceptToken("staff-token", GOOGLE_STAFF);

    const res = await request(app)
      .get("/api/studio/access")
      .set("Authorization", "Bearer staff-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ staff: true });
    // The navbar asks this on every signed-in page load, so it must not drag
    // the full-database analytics scans along with it.
    expect(mockOrders).not.toHaveBeenCalled();
    expect(mockShop).not.toHaveBeenCalled();
    expect(mockInvoices).not.toHaveBeenCalled();
  });
});
