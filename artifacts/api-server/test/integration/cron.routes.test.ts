import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the reconciliation service so the route runs end-to-end over the real
// Express stack without touching Notion.
vi.mock("../../src/services/schedule.service.js", () => ({
  reconcileMilestones: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import { reconcileMilestones } from "../../src/services/schedule.service.js";

const mockGenerate = vi.mocked(reconcileMilestones);

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
      remindersSent: 1,
      paymentRemindersSent: 0,
      restockAlertsSent: 0,
      appointmentRemindersSent: 0,
      materialsDigestItems: 0,
      cartRemindersSent: 0,
      instagramTokenRefreshed: false,
    });

    const res = await request(app)
      .get(ENDPOINT)
      .set("Authorization", "Bearer s3cret");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ordersProcessed: 2,
      milestonesCreated: 7,
      remindersSent: 1,
      paymentRemindersSent: 0,
      restockAlertsSent: 0,
      appointmentRemindersSent: 0,
      materialsDigestItems: 0,
      cartRemindersSent: 0,
      instagramTokenRefreshed: false,
    });
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
