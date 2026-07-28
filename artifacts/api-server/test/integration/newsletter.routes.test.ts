import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/notion/newsletter.repository.js", () => ({
  createNewsletterSubscription: vi.fn(),
}));

import request from "supertest";
import { newsletterInput, GENERIC_ERROR } from "@workspace/test-fixtures";
import app from "../../src/app.js";
import { createNewsletterSubscription } from "../../src/lib/notion/newsletter.repository.js";

const mockCreate = vi.mocked(createNewsletterSubscription);

describe("POST /api/newsletter", () => {
  it("returns 201 { success: true } for a valid opt-in", async () => {
    mockCreate.mockResolvedValue(undefined);

    const res = await request(app)
      .post("/api/newsletter")
      .send(newsletterInput({ source: "footer" }));

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("accepts an opt-in with no source", async () => {
    mockCreate.mockResolvedValue(undefined);

    const res = await request(app)
      .post("/api/newsletter")
      .send({ email: "grace@example.com" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
  });

  it("returns 400 for a malformed email and does not call the repository", async () => {
    const res = await request(app)
      .post("/api/newsletter")
      .send(newsletterInput({ email: "not-an-email" }));

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 500 with a generic message when the repository throws", async () => {
    mockCreate.mockRejectedValue(
      new Error("NOTION_CONTACT_DATABASE_ID is not configured"),
    );

    const res = await request(app)
      .post("/api/newsletter")
      .send(newsletterInput());

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: GENERIC_ERROR });
  });
});
