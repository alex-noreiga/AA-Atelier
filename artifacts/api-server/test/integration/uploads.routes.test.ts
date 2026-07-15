import { describe, it, expect, vi, afterEach } from "vitest";

// The route delegates the client-upload token dance to Vercel Blob's helper;
// mock it so the test exercises the route's own gating + shape without a token.
vi.mock("@vercel/blob/client", () => ({ handleUpload: vi.fn() }));

import request from "supertest";
import app from "../../src/app.js";
import { handleUpload } from "@vercel/blob/client";

const mockHandle = vi.mocked(handleUpload);

afterEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

describe("POST /api/uploads/order-refs", () => {
  it("returns 503 when Blob is not configured", async () => {
    const res = await request(app)
      .post("/api/uploads/order-refs")
      .send({ type: "blob.generate-client-token" });

    expect(res.status).toBe(503);
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it("returns the Blob client-token payload when configured", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    mockHandle.mockResolvedValue({
      type: "blob.generate-client-token",
      clientToken: "tok_123",
    } as never);

    const res = await request(app)
      .post("/api/uploads/order-refs")
      .send({ type: "blob.generate-client-token", payload: {} });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: "blob.generate-client-token",
      clientToken: "tok_123",
    });
    expect(mockHandle).toHaveBeenCalledOnce();
  });

  it("returns 400 when the Blob helper rejects (e.g. bad token)", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    mockHandle.mockRejectedValue(new Error("bad token"));

    const res = await request(app)
      .post("/api/uploads/order-refs")
      .send({ type: "blob.generate-client-token" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});
