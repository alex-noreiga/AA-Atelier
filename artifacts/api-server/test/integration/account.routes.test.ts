import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Notion repos so the overview runs through the real HTTP + auth stack
// without the network.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrdersByEmail: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  findShopOrdersByEmail: vi.fn().mockResolvedValue([]),
  // The live fulfilment-status list the portal places each shop order in.
  fetchLiveShopOrderStatuses: vi
    .fn()
    .mockResolvedValue(["Payment Confirmed", "Shipped", "Delivered"]),
}));

import request from "supertest";
import app from "../../src/app.js";
import { findOrdersByEmail } from "../../src/lib/notion/orders.repository.js";
import { findShopOrdersByEmail } from "../../src/lib/notion/shop-orders.repository.js";
import {
  __setSupabaseClientForTests,
  __resetSupabaseClient,
} from "../../src/lib/supabase/client.js";
import {
  makeFakeSupabaseClient,
  asSupabaseClient,
  type FakeClaims,
} from "../support/fake-supabase.js";

const mockOrders = vi.mocked(findOrdersByEmail);
const mockShop = vi.mocked(findShopOrdersByEmail);

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
  // supabaseConfigured() gates on these; the injected fake replaces the real
  // client, so the values just need to be non-empty.
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-test-key";
});

afterEach(() => {
  __resetSupabaseClient();
});

describe("GET /api/account/overview", () => {
  it("returns 401 without a Bearer token", async () => {
    acceptToken("good-token", { email: "skater@example.com", sub: "user-1" });
    const res = await request(app).get("/api/account/overview");

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
    expect(mockOrders).not.toHaveBeenCalled();
  });

  it("returns 401 for a token Supabase rejects", async () => {
    acceptToken("good-token", { email: "skater@example.com", sub: "user-1" });
    const res = await request(app)
      .get("/api/account/overview")
      .set("Authorization", "Bearer garbage");

    expect(res.status).toBe(401);
    expect(mockOrders).not.toHaveBeenCalled();
  });

  it("returns 401 when Supabase is not configured", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    const res = await request(app)
      .get("/api/account/overview")
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(401);
    expect(mockOrders).not.toHaveBeenCalled();
  });

  it("returns 200 with the customer's data for a valid token", async () => {
    acceptToken("good-token", { email: "skater@example.com", sub: "user-1" });
    mockOrders.mockResolvedValue([
      {
        orderNumber: "000002",
        orderName: "Ada – Custom Dress",
        currentStage: "Sewing",
        stages: ["Consultation", "Sewing", "Delivery"],
      },
    ]);
    mockShop.mockResolvedValue([
      { orderNumber: "SHP-ABC-1234", status: "Payment Confirmed", total: 42 },
    ]);

    const res = await request(app)
      .get("/api/account/overview")
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      email: "skater@example.com",
      customOrders: [
        {
          orderNumber: "000002",
          orderName: "Ada – Custom Dress",
          currentStage: "Sewing",
          stages: ["Consultation", "Sewing", "Delivery"],
          state: "active",
        },
      ],
      shopOrders: [
        {
          orderNumber: "SHP-ABC-1234",
          status: "Payment Confirmed",
          total: 42,
          state: "active",
        },
      ],
      // Google Calendar isn't configured in the test env, so the best-effort
      // appointments lookup degrades to an empty list (never failing the route).
      appointments: [],
    });
    expect(mockOrders).toHaveBeenCalledWith("skater@example.com");
  });

  it("looks orders up by the lowercased email from the token", async () => {
    acceptToken("good-token", { email: "Skater@Example.com", sub: "user-1" });
    mockOrders.mockResolvedValue([]);
    mockShop.mockResolvedValue([]);

    const res = await request(app)
      .get("/api/account/overview")
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(200);
    expect(res.body.email).toBe("skater@example.com");
    expect(mockOrders).toHaveBeenCalledWith("skater@example.com");
  });
});
