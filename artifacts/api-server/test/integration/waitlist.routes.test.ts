import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/notion/waitlist.repository.js", () => ({
  createWaitlistEntry: vi.fn(),
}));
vi.mock("../../src/lib/notion/clients.repository.js", () => ({
  upsertClientByEmail: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import { createWaitlistEntry } from "../../src/lib/notion/waitlist.repository.js";
import { upsertClientByEmail } from "../../src/lib/notion/clients.repository.js";

const mockCreate = vi.mocked(createWaitlistEntry);
const mockUpsert = vi.mocked(upsertClientByEmail);

const entry = { name: "Ada Skater", email: "ada@example.com" };

/**
 * The public submission forms share one per-IP limiter (5 requests / 10 min),
 * and this file has more cases than that. The app runs with `trust proxy`, so
 * each case presents its own client address and gets its own budget — which
 * keeps the cases independent rather than ordering-sensitive. The limiter
 * itself is covered by `submission-rate-limit.routes.test.ts`.
 */
let ip = 0;
function post(body: object) {
  ip += 1;
  return request(app)
    .post("/api/waitlist")
    .set("X-Forwarded-For", `203.0.113.${ip}`)
    .send(body);
}

beforeEach(() => {
  mockCreate.mockResolvedValue(undefined);
  mockUpsert.mockResolvedValue(null);
});

describe("POST /api/waitlist", () => {
  it("returns 201 and files the entry", async () => {
    const res = await post(entry);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("is accepted even while the books are open", async () => {
    // Nothing about this route consults capacity: a customer planning next
    // season ahead of time is not a mistake to reject.
    const res = await post(entry);
    expect(res.status).toBe(201);
  });

  it("records what the piece is for, in the customer's own words", async () => {
    // Free text on purpose — the studio makes for skating and dance alike, so
    // the events its customers work towards run from competitions to recitals
    // to showcases, and no list the studio could keep would cover them.
    await post({
      ...entry,
      eventName: "  Rocket City Classic  ",
      neededBy: "2027-01-16",
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { eventName: "Rocket City Classic", date: "2027-01-16" },
      }),
      undefined,
      undefined,
    );
  });

  it("records a bare needed-by date when no event was named", async () => {
    await post({ ...entry, neededBy: "2027-02-01" });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ target: { date: "2027-02-01" } }),
      undefined,
      undefined,
    );
  });

  it("records an empty target when the customer skipped both", async () => {
    await post(entry);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ target: {} }),
      undefined,
      undefined,
    );
  });

  it("links the CRM record when one was resolved", async () => {
    mockUpsert.mockResolvedValue("client-1");

    await post(entry);

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ada@example.com", status: "Lead" }),
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      "client-1",
    );
  });

  it("still files the entry when the CRM upsert fails", async () => {
    mockUpsert.mockRejectedValue(new Error("CRM is down"));

    const res = await post(entry);

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("silently drops a honeypot-filled submission without writing to Notion", async () => {
    const res = await post({ ...entry, website: "http://spam.example" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing name and does not write", async () => {
    const res = await post({ email: "ada@example.com" });

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed email", async () => {
    const res = await post({ name: "Ada", email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
