import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/notion/contact.repository.js", () => ({
  createContactMessage: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import { createContactMessage } from "../../src/lib/notion/contact.repository.js";

const mockCreate = vi.mocked(createContactMessage);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/contact", () => {
  it("returns 201 { success: true } for a valid message", async () => {
    mockCreate.mockResolvedValue(undefined);

    const res = await request(app).post("/api/contact").send({
      name: "Grace Hopper",
      email: "grace@example.com",
      message: "Do you ship internationally?",
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("returns 400 for a missing message and does not call the repository", async () => {
    const res = await request(app)
      .post("/api/contact")
      .send({ name: "Grace", email: "grace@example.com" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 500 with a generic message when the repository throws", async () => {
    mockCreate.mockRejectedValue(
      new Error("NOTION_CONTACT_DATABASE_ID is not configured"),
    );

    const res = await request(app).post("/api/contact").send({
      name: "Grace Hopper",
      email: "grace@example.com",
      message: "Hello",
    });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: "Something went wrong. Please try again later.",
    });
  });
});
