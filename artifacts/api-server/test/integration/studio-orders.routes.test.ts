import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Notion adapter so the real service + route + auth stack runs without
// the network. The notifier is left REAL below the send, so what is asserted
// here is that a stage change actually reaches the same email path the webhook
// uses — the whole point of the feature.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderForStageNotification: vi.fn(),
  findOrderForStageNotificationByPageId: vi.fn(),
  listOrdersForStageBoard: vi.fn(),
  updateLastNotifiedStage: vi.fn(),
  updateOrderStage: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
  sendEmail: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import {
  findOrderForStageNotification,
  findOrderForStageNotificationByPageId,
  listOrdersForStageBoard,
  updateLastNotifiedStage,
  updateOrderStage,
  type OrderStageNotification,
} from "../../src/lib/notion/orders.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import {
  __setSupabaseClientForTests,
  __resetSupabaseClient,
} from "../../src/lib/supabase/client.js";
import {
  makeFakeSupabaseClient,
  asSupabaseClient,
  type FakeClaims,
} from "../support/fake-supabase.js";

const mockFind = vi.mocked(findOrderForStageNotification);
const mockFindByPageId = vi.mocked(findOrderForStageNotificationByPageId);
const mockList = vi.mocked(listOrdersForStageBoard);
const mockMarker = vi.mocked(updateLastNotifiedStage);
const mockWrite = vi.mocked(updateOrderStage);
const mockSend = vi.mocked(sendEmailBestEffort);

const STAFF = "alexandra@a3iceanddance.com";
const GOOGLE_STAFF: FakeClaims = {
  email: STAFF,
  sub: "user-1",
  amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
};

const STAGES = ["Consultation", "Sketching", "Sewing", "Fitting", "Delivered"];

function order(
  overrides: Partial<OrderStageNotification> = {},
): OrderStageNotification {
  return {
    pageId: "page-1",
    orderNumber: "ORD-000002",
    orderName: "Ada – Custom Costume",
    email: "ada@example.com",
    currentStage: "Sketching",
    stages: STAGES,
    lastNotifiedStage: "Sketching",
    cancelled: false,
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
  process.env.RESEND_FROM_EMAIL = "orders@a3iceanddance.com";
  delete process.env.STUDIO_REQUIRE_GOOGLE;
  mockList.mockResolvedValue([order()]);
  mockFind.mockResolvedValue(order());
  // What the notifier reads back after the write — the new stage, as a direct
  // page fetch would return it.
  mockFindByPageId.mockResolvedValue(order({ currentStage: "Sewing" }));
  mockWrite.mockResolvedValue(undefined);
  mockMarker.mockResolvedValue(undefined);
  mockSend.mockResolvedValue(undefined);
  acceptToken("staff-token", GOOGLE_STAFF);
});

afterEach(() => {
  __resetSupabaseClient();
  delete process.env.STUDIO_STAFF_EMAILS;
  delete process.env.STUDIO_REQUIRE_GOOGLE;
  delete process.env.RESEND_FROM_EMAIL;
});

// Moving a stage emails a real customer, so the gate matters as much here as on
// any other studio write.
describe("the staff gate applies to the stage board", () => {
  const cases: Array<[string, () => request.Test]> = [
    ["GET", () => request(app).get("/api/studio/orders")],
    [
      "PUT",
      () =>
        request(app)
          .put("/api/studio/orders/ORD-000002/stage")
          .send({ stage: "Sewing" }),
    ],
  ];

  it.each(cases)("%s answers 401 without a Bearer token", async (_, call) => {
    expect((await call()).status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
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
      expect(mockWrite).not.toHaveBeenCalled();
    },
  );
});

describe("GET /api/studio/orders", () => {
  it("lists the open orders with their position and next stage", async () => {
    mockList.mockResolvedValue([
      order({ estimatedCompletion: "2026-09-10", service: "Custom Costume" }),
    ]);

    const res = await request(app)
      .get("/api/studio/orders")
      .set("Authorization", "Bearer staff-token");

    expect(res.status).toBe(200);
    expect(res.body.orders).toEqual([
      {
        orderNumber: "ORD-000002",
        orderName: "Ada – Custom Costume",
        currentStage: "Sketching",
        stages: STAGES,
        nextStage: "Sewing",
        lastNotifiedStage: "Sketching",
        service: "Custom Costume",
        dueDate: "2026-09-10",
        notifiable: true,
      },
    ]);
  });

  // The board is keyed on the order number like every other studio operation,
  // and the address is no part of deciding what to make next.
  it("never returns the customer's email address", async () => {
    const res = await request(app)
      .get("/api/studio/orders")
      .set("Authorization", "Bearer staff-token");

    expect(JSON.stringify(res.body)).not.toContain("ada@example.com");
  });
});

describe("PUT /api/studio/orders/:orderNumber/stage", () => {
  it("writes the stage and emails the customer in the same request", async () => {
    const res = await request(app)
      .put("/api/studio/orders/ORD-000002/stage")
      .set("Authorization", "Bearer staff-token")
      .send({ stage: "Sewing" });

    expect(res.status).toBe(200);
    expect(mockWrite).toHaveBeenCalledWith("page-1", "Sewing");
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0]).toMatchObject({
      to: "ada@example.com",
    });
    expect(res.body).toMatchObject({
      previousStage: "Sketching",
      changed: true,
      notification: "sent",
      order: { currentStage: "Sewing", nextStage: "Fitting" },
    });
  });

  it("advances the Last Notified Stage marker, so a Notion re-fire sends nothing", async () => {
    await request(app)
      .put("/api/studio/orders/ORD-000002/stage")
      .set("Authorization", "Bearer staff-token")
      .send({ stage: "Sewing" });

    expect(mockMarker).toHaveBeenCalledWith("page-1", "Sewing");
  });

  it("suppresses the email on request but still moves the marker", async () => {
    const res = await request(app)
      .put("/api/studio/orders/ORD-000002/stage")
      .set("Authorization", "Bearer staff-token")
      .send({ stage: "Sewing", notify: false });

    expect(res.status).toBe(200);
    expect(res.body.notification).toBe("suppressed");
    expect(mockWrite).toHaveBeenCalledWith("page-1", "Sewing");
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockMarker).toHaveBeenCalledWith("page-1", "Sewing");
  });

  it("400s a stage the order's service doesn't walk", async () => {
    mockFind.mockResolvedValue(
      order({
        currentStage: "Piece Received",
        stages: ["Consultation", "Piece Received", "Delivered"],
      }),
    );

    const res = await request(app)
      .put("/api/studio/orders/ORD-000002/stage")
      .set("Authorization", "Bearer staff-token")
      .send({ stage: "Sketching" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Piece Received/);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("404s an unknown order", async () => {
    mockFind.mockResolvedValue(null);

    const res = await request(app)
      .put("/api/studio/orders/ORD-nope/stage")
      .set("Authorization", "Bearer staff-token")
      .send({ stage: "Sewing" });

    expect(res.status).toBe(404);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("409s a cancelled order", async () => {
    mockFind.mockResolvedValue(order({ cancelled: true }));

    const res = await request(app)
      .put("/api/studio/orders/ORD-000002/stage")
      .set("Authorization", "Bearer staff-token")
      .send({ stage: "Sewing" });

    expect(res.status).toBe(409);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("400s a body with no stage at all, before the order is read", async () => {
    const res = await request(app)
      .put("/api/studio/orders/ORD-000002/stage")
      .set("Authorization", "Bearer staff-token")
      .send({});

    expect(res.status).toBe(400);
    expect(mockFind).not.toHaveBeenCalled();
  });
});
