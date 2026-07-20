import { describe, it, expect, vi } from "vitest";

// Mock the Notion relay so the HTTP stack (raw-body parsing → handler →
// response) runs end-to-end without the network.
vi.mock("../../src/lib/notion/file-uploads.repository.js", () => ({
  uploadImageToNotion: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import { uploadImageToNotion } from "../../src/lib/notion/file-uploads.repository.js";

const mockUpload = vi.mocked(uploadImageToNotion);

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("POST /api/orders/reference-images", () => {
  it("relays an accepted image to Notion and returns 201 with the id", async () => {
    mockUpload.mockResolvedValue("upload-42");

    const res = await request(app)
      .post("/api/orders/reference-images?filename=my%20photo.png")
      .set("Content-Type", "image/png")
      .send(PNG_BYTES);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "upload-42" });
    expect(mockUpload).toHaveBeenCalledOnce();
    const arg = mockUpload.mock.calls[0][0];
    expect(arg.contentType).toBe("image/png");
    // Filename is sanitized and given the type's extension.
    expect(arg.filename).toBe("my photo.png");
    expect(Buffer.isBuffer(arg.data)).toBe(true);
  });

  it("rejects an unsupported content type with 400 (never calls Notion)", async () => {
    const res = await request(app)
      .post("/api/orders/reference-images")
      .set("Content-Type", "application/pdf")
      .send(Buffer.from("%PDF-1.4"));

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("rejects an empty body with 400", async () => {
    const res = await request(app)
      .post("/api/orders/reference-images")
      .set("Content-Type", "image/jpeg")
      .send(Buffer.alloc(0));

    expect(res.status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("returns 502 when the Notion relay fails", async () => {
    mockUpload.mockRejectedValue(new Error("notion down"));

    const res = await request(app)
      .post("/api/orders/reference-images")
      .set("Content-Type", "image/jpeg")
      .send(Buffer.from([0xff, 0xd8, 0xff]));

    expect(res.status).toBe(502);
    expect(res.body).toHaveProperty("error");
  });
});
