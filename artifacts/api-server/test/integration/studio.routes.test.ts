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
});

describe("GET /api/studio/analytics", () => {
  it("returns 401 without a Bearer token", async () => {
    acceptToken("good-token", { email: STAFF, sub: "user-1" });
    const res = await request(app).get("/api/studio/analytics");
    expect(res.status).toBe(401);
    expect(mockOrders).not.toHaveBeenCalled();
  });

  it("returns 401 for a token Supabase rejects", async () => {
    acceptToken("good-token", { email: STAFF, sub: "user-1" });
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
    });
    const res = await request(app)
      .get("/api/studio/analytics")
      .set("Authorization", "Bearer customer-token");

    expect(res.status).toBe(403);
    expect(mockOrders).not.toHaveBeenCalled();
  });

  it("returns 403 for everyone when no allowlist is configured", async () => {
    delete process.env.STUDIO_STAFF_EMAILS;
    acceptToken("staff-token", { email: STAFF, sub: "user-1" });

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
    acceptToken("staff-token", { email: STAFF, sub: "user-1" });

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
      email: "ALEXANDRA@a3iceanddance.com",
      sub: "user-1",
    });

    const res = await request(app)
      .get("/api/studio/analytics")
      .set("Authorization", "Bearer staff-token");

    expect(res.status).toBe(200);
  });
});
