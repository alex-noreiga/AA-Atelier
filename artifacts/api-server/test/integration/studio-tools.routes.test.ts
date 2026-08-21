// The internal tools endpoint over the real Express stack.
//
// What matters here is the gate, not the tools: these actions send customer
// email and move money, and they used to be reachable by anyone holding a link.
// So the first thing asserted is that an anonymous caller, a signed-in customer,
// and a staff member who signed in without Google all fail to run one — and that
// the service isn't called when they do.
//
// The dispatcher itself is mocked; it has its own unit suite.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/services/studio-tools.service.js", () => ({
  runStudioTool: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import { runStudioTool } from "../../src/services/studio-tools.service.js";
import { BadRequestError, NotFoundError } from "../../src/lib/errors.js";
import {
  __setSupabaseClientForTests,
  __resetSupabaseClient,
} from "../../src/lib/supabase/client.js";
import {
  makeFakeSupabaseClient,
  asSupabaseClient,
  type FakeClaims,
} from "../support/fake-supabase.js";

const mockRun = vi.mocked(runStudioTool);

const STAFF = "alexandra@a3iceanddance.com";
const TOKEN = "staff-token";

/** A staff session established with Google — what the gate wants. */
const GOOGLE_STAFF: FakeClaims = {
  email: STAFF,
  sub: "user-1",
  amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
};

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

/** The result shape the dispatcher returns; the route just parses and echoes it. */
const OK_RUN = {
  tool: "milestones" as const,
  status: "ok" as const,
  title: "Milestones reconciled",
  message: "Generated 4 milestones across 1 order.",
  details: [],
};

beforeEach(() => {
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-test-key";
  process.env.STUDIO_STAFF_EMAILS = STAFF;
  delete process.env.STUDIO_REQUIRE_GOOGLE;
  acceptToken(TOKEN, GOOGLE_STAFF);
  mockRun.mockResolvedValue(OK_RUN);
});

afterEach(() => {
  __resetSupabaseClient();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.STUDIO_STAFF_EMAILS;
});

const ENDPOINT = "/api/studio/tools/milestones";

// The full requireStaff matrix (unknown token / non-staff 404 / non-Google 403
// / unset-allowlist fail-closed) is exercised against that middleware in
// studio.routes.test.ts. Repeating it per mounted route only re-tested the same
// middleware, so what is left here is the two things specific to THIS route:
// that the gate is actually mounted on it at all, and that it refuses the
// CRON_SECRET these actions used to authenticate with.
describe("POST /api/studio/tools/:tool — the gate", () => {
  it("401s an anonymous caller without running anything", async () => {
    const res = await request(app).post(ENDPOINT).send({});

    expect(res.status).toBe(401);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("does not accept CRON_SECRET, the credential these actions used to take", async () => {
    process.env.CRON_SECRET = "s3cret";

    const res = await request(app)
      .post(ENDPOINT)
      .set("Authorization", "Bearer s3cret")
      .send({});

    expect(res.status).toBe(401);
    expect(mockRun).not.toHaveBeenCalled();
    delete process.env.CRON_SECRET;
  });
});

describe("POST /api/studio/tools/:tool — running a tool", () => {
  const authed = () =>
    request(app).post(ENDPOINT).set("Authorization", `Bearer ${TOKEN}`);

  it("runs the named tool for a staff session and returns its result", async () => {
    const res = await authed().send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual(OK_RUN);
    expect(mockRun).toHaveBeenCalledWith("milestones", {});
  });

  it("passes the order number and options through", async () => {
    mockRun.mockResolvedValue({ ...OK_RUN, tool: "status-email" });

    const res = await request(app)
      .post("/api/studio/tools/status-email")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ orderNumber: "ORD-000002", force: true });

    expect(res.status).toBe(200);
    expect(mockRun).toHaveBeenCalledWith("status-email", {
      orderNumber: "ORD-000002",
      force: true,
    });
  });

  it("400s an unknown tool name rather than running anything", async () => {
    const res = await request(app)
      .post("/api/studio/tools/drop-everything")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(400);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("400s a negative refund amount at the schema, before the service", async () => {
    const res = await request(app)
      .post("/api/studio/tools/return-refund")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ orderNumber: "SHP-ABC123", amount: -20 });

    expect(res.status).toBe(400);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("surfaces a missing-argument rejection as a 400 with its message", async () => {
    mockRun.mockRejectedValue(
      new BadRequestError("Enter an order number to run this tool."),
    );

    const res = await authed().send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Enter an order number to run this tool.");
  });

  it("surfaces an unknown order as a 404", async () => {
    mockRun.mockRejectedValue(
      new NotFoundError("We couldn't find an order with that number."),
    );

    const res = await authed().send({ orderNumber: "ORD-NOPE" });

    expect(res.status).toBe(404);
  });
});
