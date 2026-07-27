import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the notification service so the routes run end-to-end over the real
// Express stack without touching Notion or Resend.
vi.mock("../../src/services/order-notification.service.js", () => ({
  notifyOrderStageChange: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import { notifyOrderStageChange } from "../../src/services/order-notification.service.js";

const mockNotify = vi.mocked(notifyOrderStageChange);

const WEBHOOK = "/api/webhooks/notion-stage-change";
const RUN = "/api/webhooks/notion-stage-change/run";

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("POST /api/webhooks/notion-stage-change (Notion automation)", () => {
  it("notifies for the order in the JSON body and returns the result", async () => {
    mockNotify.mockResolvedValue({
      orderNumber: "000002",
      status: "sent",
      currentStage: "Sketching",
    });

    const res = await request(app)
      .post(`${WEBHOOK}?secret=s3cret`)
      .send({ orderNumber: "000002" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      orderNumber: "000002",
      status: "sent",
      currentStage: "Sketching",
    });
    expect(mockNotify).toHaveBeenCalledWith({ orderNumber: "000002" });
  });

  it("resolves by the page id in Notion's default payload (no authored body)", async () => {
    mockNotify.mockResolvedValue({ orderNumber: "000002", status: "sent" });

    const res = await request(app)
      .post(`${WEBHOOK}?secret=s3cret`)
      .send({ data: { object: "page", id: "page-xyz" } });

    expect(res.status).toBe(200);
    expect(mockNotify).toHaveBeenCalledWith({ pageId: "page-xyz" });
  });

  it("prefers an authored orderNumber body over the payload page id", async () => {
    mockNotify.mockResolvedValue({ orderNumber: "000002", status: "sent" });

    const res = await request(app)
      .post(`${WEBHOOK}?secret=s3cret`)
      .send({ orderNumber: "000002", data: { id: "page-xyz" } });

    expect(res.status).toBe(200);
    expect(mockNotify).toHaveBeenCalledWith({ orderNumber: "000002" });
  });

  it("also accepts the order number as an ?order= query param", async () => {
    mockNotify.mockResolvedValue({ orderNumber: "000002", status: "sent" });

    const res = await request(app).post(
      `${WEBHOOK}?secret=s3cret&order=000002`,
    );

    expect(res.status).toBe(200);
    expect(mockNotify).toHaveBeenCalledWith({ orderNumber: "000002" });
  });

  it("authorizes via a Bearer header with no query secret", async () => {
    mockNotify.mockResolvedValue({ orderNumber: "000002", status: "sent" });

    const res = await request(app)
      .post(WEBHOOK)
      .set("Authorization", "Bearer s3cret")
      .send({ orderNumber: "000002" });

    expect(res.status).toBe(200);
    expect(mockNotify).toHaveBeenCalledWith({ orderNumber: "000002" });
  });

  it("returns 401 for a wrong Bearer header and does not run", async () => {
    const res = await request(app)
      .post(WEBHOOK)
      .set("Authorization", "Bearer nope")
      .send({ orderNumber: "000002" });

    expect(res.status).toBe(401);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("returns 400 when no order number is supplied", async () => {
    const res = await request(app).post(`${WEBHOOK}?secret=s3cret`).send({});

    expect(res.status).toBe(400);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong secret and does not run", async () => {
    const res = await request(app)
      .post(`${WEBHOOK}?secret=nope`)
      .send({ orderNumber: "000002" });

    expect(res.status).toBe(401);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is not configured, even with a secret", async () => {
    delete process.env.CRON_SECRET;

    const res = await request(app)
      .post(`${WEBHOOK}?secret=s3cret`)
      .send({ orderNumber: "000002" });

    expect(res.status).toBe(401);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("returns 500 (JSON) when the service throws", async () => {
    mockNotify.mockRejectedValue(new Error("Notion is down"));

    const res = await request(app)
      .post(`${WEBHOOK}?secret=s3cret`)
      .send({ orderNumber: "000002" });

    expect(res.status).toBe(500);
  });
});

describe("GET /api/webhooks/notion-stage-change/run (on-demand link)", () => {
  it("sends and returns an HTML confirmation naming the order + stage", async () => {
    mockNotify.mockResolvedValue({
      orderNumber: "000002",
      status: "sent",
      currentStage: "Sketching",
    });

    const res = await request(app).get(`${RUN}?secret=s3cret&order=000002`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("000002");
    expect(res.text).toContain("Sketching");
    expect(mockNotify).toHaveBeenCalledWith(
      { orderNumber: "000002" },
      { force: false },
    );
  });

  it("passes force through when ?force=1 is set (a manual resend)", async () => {
    mockNotify.mockResolvedValue({
      orderNumber: "000002",
      status: "sent",
      currentStage: "Sketching",
    });

    const res = await request(app).get(
      `${RUN}?secret=s3cret&order=000002&force=1`,
    );

    expect(res.status).toBe(200);
    expect(mockNotify).toHaveBeenCalledWith(
      { orderNumber: "000002" },
      { force: true },
    );
  });

  it("reports a not-found order in the HTML", async () => {
    mockNotify.mockResolvedValue({
      orderNumber: "ORD-NOPE",
      status: "not_found",
    });

    const res = await request(app).get(`${RUN}?secret=s3cret&order=ORD-NOPE`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("No order found");
  });

  it("reports a skipped send (e.g. no email) in the HTML", async () => {
    mockNotify.mockResolvedValue({
      orderNumber: "000002",
      status: "skipped",
      reason: "no email on order",
    });

    const res = await request(app).get(`${RUN}?secret=s3cret&order=000002`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("no email on order");
  });

  it("returns 400 (HTML) when no order is given", async () => {
    const res = await request(app).get(`${RUN}?secret=s3cret`);

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("returns 401 (HTML) for a wrong secret and does not run", async () => {
    const res = await request(app).get(`${RUN}?secret=nope&order=000002`);

    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Not authorized");
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("renders an HTML error page (not JSON) if the service throws", async () => {
    mockNotify.mockRejectedValue(new Error("Notion is down"));

    const res = await request(app).get(`${RUN}?secret=s3cret&order=000002`);

    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Something went wrong");
  });
});
