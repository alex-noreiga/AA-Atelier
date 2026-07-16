import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the reconciliation service so the route runs end-to-end over the real
// Express stack without touching Notion.
vi.mock("../../src/services/schedule.service.js", () => ({
  generatePendingMilestones: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import { generatePendingMilestones } from "../../src/services/schedule.service.js";

const mockGenerate = vi.mocked(generatePendingMilestones);

const ENDPOINT = "/api/cron/generate-milestones";

describe("GET /api/cron/generate-milestones", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("runs the reconciliation and returns its summary with a valid bearer token", async () => {
    mockGenerate.mockResolvedValue({
      ordersProcessed: 2,
      milestonesCreated: 7,
    });

    const res = await request(app)
      .get(ENDPOINT)
      .set("Authorization", "Bearer s3cret");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ordersProcessed: 2, milestonesCreated: 7 });
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("returns 401 and does not run when the bearer token is wrong", async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .set("Authorization", "Bearer nope");

    expect(res.status).toBe(401);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await request(app).get(ENDPOINT);

    expect(res.status).toBe(401);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is not configured, even with a header", async () => {
    delete process.env.CRON_SECRET;

    const res = await request(app)
      .get(ENDPOINT)
      .set("Authorization", "Bearer s3cret");

    expect(res.status).toBe(401);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/generate-milestones/run (Notion button)", () => {
  const RUN = "/api/cron/generate-milestones/run";

  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("runs the reconciliation and returns an HTML confirmation for a valid query secret", async () => {
    mockGenerate.mockResolvedValue({
      ordersProcessed: 2,
      milestonesCreated: 7,
    });

    const res = await request(app).get(`${RUN}?secret=s3cret`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Milestones generated");
    expect(res.text).toContain("across 2 orders");
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("reports when nothing was pending", async () => {
    mockGenerate.mockResolvedValue({
      ordersProcessed: 0,
      milestonesCreated: 0,
    });

    const res = await request(app).get(`${RUN}?secret=s3cret`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("already up to date");
  });

  it("returns 401 (HTML) for a wrong secret and does not run", async () => {
    const res = await request(app).get(`${RUN}?secret=nope`);

    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Not authorized");
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("returns 401 when no secret query param is provided", async () => {
    const res = await request(app).get(RUN);

    expect(res.status).toBe(401);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;

    const res = await request(app).get(`${RUN}?secret=s3cret`);

    expect(res.status).toBe(401);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("renders an HTML error page (not a JSON envelope) if the service throws", async () => {
    mockGenerate.mockRejectedValue(new Error("Notion is down"));

    const res = await request(app).get(`${RUN}?secret=s3cret`);

    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Something went wrong");
  });
});
