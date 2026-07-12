import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/notion/notify.repository.js", () => ({
  createBackInStockRequest: vi.fn(),
}));

import request from "supertest";
import { notifyInput, GENERIC_ERROR } from "@workspace/test-fixtures";
import app from "../../src/app.js";
import { createBackInStockRequest } from "../../src/lib/notion/notify.repository.js";

const mockCreate = vi.mocked(createBackInStockRequest);

describe("POST /api/notify", () => {
  it("returns 201 { success: true } for a valid request", async () => {
    mockCreate.mockResolvedValue(undefined);

    const res = await request(app)
      .post("/api/notify")
      .send(notifyInput({ size: "Adult S" }));

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("returns 400 for a malformed email and does not call the repository", async () => {
    const res = await request(app)
      .post("/api/notify")
      .send(notifyInput({ email: "not-an-email" }));

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 500 with a generic message when the repository throws", async () => {
    mockCreate.mockRejectedValue(
      new Error("NOTION_CONTACT_DATABASE_ID is not configured"),
    );

    const res = await request(app).post("/api/notify").send(notifyInput());

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: GENERIC_ERROR });
  });
});
