import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Notion repos so the overview runs through the real HTTP + auth stack
// without the network, and the mailer so login doesn't try to send.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrdersByEmail: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  findShopOrdersByEmail: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn().mockResolvedValue(undefined),
}));

import request from "supertest";
import app from "../../src/app.js";
import { findOrdersByEmail } from "../../src/lib/notion/orders.repository.js";
import { findShopOrdersByEmail } from "../../src/lib/notion/shop-orders.repository.js";
import {
  signToken,
  SESSION_TTL_SECONDS,
  MAGIC_LINK_TTL_SECONDS,
} from "../../src/lib/auth/tokens.js";
import { SESSION_COOKIE } from "../../src/lib/auth/cookies.js";

const mockOrders = vi.mocked(findOrdersByEmail);
const mockShop = vi.mocked(findShopOrdersByEmail);

function sessionCookie(email = "skater@example.com"): string {
  return `${SESSION_COOKIE}=${signToken(email, "session", SESSION_TTL_SECONDS)}`;
}

beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.PUBLIC_BASE_URL = "https://atelier.test";
});

describe("POST /api/account/login", () => {
  it("returns 200 with a generic message (never reveals whether orders exist)", async () => {
    const res = await request(app)
      .post("/api/account/login")
      .send({ email: "someone@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("message");
  });

  it("returns 400 for an invalid email", async () => {
    const res = await request(app)
      .post("/api/account/login")
      .send({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("GET /api/account/overview", () => {
  it("returns 401 without a session cookie", async () => {
    const res = await request(app).get("/api/account/overview");

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
    expect(mockOrders).not.toHaveBeenCalled();
  });

  it("returns 401 for a session token signed with the wrong purpose", async () => {
    const magic = signToken("a@b.com", "magic", MAGIC_LINK_TTL_SECONDS);
    const res = await request(app)
      .get("/api/account/overview")
      .set("Cookie", `${SESSION_COOKIE}=${magic}`);

    expect(res.status).toBe(401);
  });

  it("returns 200 with the customer's orders for a valid session", async () => {
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
      .set("Cookie", sessionCookie("skater@example.com"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      email: "skater@example.com",
      customOrders: [
        {
          orderNumber: "000002",
          orderName: "Ada – Custom Dress",
          currentStage: "Sewing",
          stages: ["Consultation", "Sewing", "Delivery"],
        },
      ],
      shopOrders: [
        { orderNumber: "SHP-ABC-1234", status: "Payment Confirmed", total: 42 },
      ],
    });
    expect(mockOrders).toHaveBeenCalledWith("skater@example.com");
  });
});

describe("POST /api/account/logout", () => {
  it("returns 200 and clears the session cookie", async () => {
    const res = await request(app).post("/api/account/logout");

    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(
      true,
    );
    // Cleared cookies are set to an empty value with an expiry in the past.
    expect(setCookie.join(";")).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

describe("GET /api/account/verify", () => {
  it("exchanges a valid magic token for a session cookie and redirects to /account", async () => {
    const magic = signToken(
      "skater@example.com",
      "magic",
      MAGIC_LINK_TTL_SECONDS,
    );

    const res = await request(app).get(`/api/account/verify?token=${magic}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/account");
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(
      true,
    );
    expect(setCookie.join(";")).toMatch(/HttpOnly/i);
  });

  it("redirects an invalid/expired token back to sign-in without a session", async () => {
    const res = await request(app).get("/api/account/verify?token=garbage");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/account/login?error=expired");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});
