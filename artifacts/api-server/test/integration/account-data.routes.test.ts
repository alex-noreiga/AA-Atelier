import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The customer's data rights over the real HTTP + auth stack, with every store
// the export reads (and the deletion request writes to) mocked out.
vi.mock("../../src/services/account.service.js", () => ({
  listCustomOrders: vi.fn().mockResolvedValue([]),
  listShopOrders: vi.fn().mockResolvedValue([]),
  upcomingAppointments: vi.fn().mockResolvedValue([]),
  getAccountOverview: vi.fn(),
}));
vi.mock("../../src/lib/notion/clients.repository.js", () => ({
  findClientProfileByEmail: vi.fn().mockResolvedValue(null),
  upsertClientByEmail: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../src/lib/notion/requests.repository.js", () => ({
  listRequestsByEmail: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/lib/notion/reviews.repository.js", () => ({
  listReviewsByEmail: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/lib/notion/data-deletion.repository.js", () => ({
  createDataDeletionRequest: vi.fn(),
  hasOpenDataDeletionRequest: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../src/lib/resend/audience.js", () => ({
  listAudienceContacts: vi.fn().mockResolvedValue(null),
  membershipIn: vi.fn().mockReturnValue(null),
  unsubscribeAudienceContact: vi.fn().mockResolvedValue("unsubscribed"),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import { listCustomOrders } from "../../src/services/account.service.js";
import { listRequestsByEmail } from "../../src/lib/notion/requests.repository.js";
import {
  createDataDeletionRequest,
  hasOpenDataDeletionRequest,
} from "../../src/lib/notion/data-deletion.repository.js";
import { unsubscribeAudienceContact } from "../../src/lib/resend/audience.js";
import {
  __setSupabaseClientForTests,
  __resetSupabaseClient,
} from "../../src/lib/supabase/client.js";
import {
  makeFakeSupabaseClient,
  asSupabaseClient,
  type FakeClaims,
} from "../support/fake-supabase.js";

const mockCustomOrders = vi.mocked(listCustomOrders);
const mockRequests = vi.mocked(listRequestsByEmail);
const mockCreateDeletion = vi.mocked(createDataDeletionRequest);
const mockHasOpen = vi.mocked(hasOpenDataDeletionRequest);
const mockUnsubscribe = vi.mocked(unsubscribeAudienceContact);

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
  acceptToken("good-token", { email: "Skater@Example.com", sub: "user-1" });
});

afterEach(() => {
  __resetSupabaseClient();
});

describe("GET /api/account/export", () => {
  it("returns 401 without a Bearer token, and reads nothing", async () => {
    const res = await request(app).get("/api/account/export");

    expect(res.status).toBe(401);
    expect(mockCustomOrders).not.toHaveBeenCalled();
  });

  it("gathers the customer's data under the lowercased session email", async () => {
    const res = await request(app)
      .get("/api/account/export")
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(200);
    expect(res.body.email).toBe("skater@example.com");
    expect(res.body.userId).toBe("user-1");
    expect(res.body.unavailable).toEqual([]);
    expect(res.body.marketing).toEqual({ status: "unknown" });
    expect(mockCustomOrders).toHaveBeenCalledWith("skater@example.com");
  });

  it("tells every cache not to keep a copy of the customer's whole record", async () => {
    const res = await request(app)
      .get("/api/account/export")
      .set("Authorization", "Bearer good-token");

    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("still answers 200 when a source is unreadable, naming what is missing", async () => {
    mockRequests.mockRejectedValueOnce(new Error("Notion 503"));

    const res = await request(app)
      .get("/api/account/export")
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(200);
    expect(res.body.unavailable).toEqual(["Requests you've sent us"]);
    expect(res.body.requests).toEqual([]);
  });
});

describe("POST /api/account/deletion-requests", () => {
  it("returns 401 without a Bearer token, and files nothing", async () => {
    const res = await request(app)
      .post("/api/account/deletion-requests")
      .send({});

    expect(res.status).toBe(401);
    expect(mockCreateDeletion).not.toHaveBeenCalled();
    expect(mockUnsubscribe).not.toHaveBeenCalled();
  });

  it("files the request for the signed-in customer and reports the opt-out", async () => {
    const res = await request(app)
      .post("/api/account/deletion-requests")
      .set("Authorization", "Bearer good-token")
      .send({ note: "Please finish ORD-1 first." });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      received: true,
      alreadyRequested: false,
      marketing: "unsubscribed",
    });
    expect(mockCreateDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "skater@example.com",
        userId: "user-1",
        note: "Please finish ORD-1 first.",
      }),
      undefined,
      undefined,
    );
  });

  it("accepts an empty body — the session is the whole identity", async () => {
    const res = await request(app)
      .post("/api/account/deletion-requests")
      .set("Authorization", "Bearer good-token")
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.received).toBe(true);
  });

  it("rejects a note longer than the contract allows", async () => {
    const res = await request(app)
      .post("/api/account/deletion-requests")
      .set("Authorization", "Bearer good-token")
      .send({ note: "x".repeat(2001) });

    expect(res.status).toBe(400);
    expect(mockCreateDeletion).not.toHaveBeenCalled();
  });

  it("reports a request already on file instead of filing a duplicate", async () => {
    mockHasOpen.mockResolvedValueOnce(true);

    const res = await request(app)
      .post("/api/account/deletion-requests")
      .set("Authorization", "Bearer good-token")
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.alreadyRequested).toBe(true);
    expect(mockCreateDeletion).not.toHaveBeenCalled();
  });
});
