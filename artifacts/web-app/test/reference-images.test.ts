import { describe, it, expect, vi, afterEach } from "vitest";
import { uploadReferenceImage } from "@/lib/reference-images";

afterEach(() => {
  vi.unstubAllGlobals();
});

// A GIF file skips the canvas re-encode path (which jsdom can't run), so it
// exercises the upload transport directly.
function gifFile(size = 1024): File {
  return new File([new Uint8Array(size)], "clip.gif", { type: "image/gif" });
}

describe("uploadReferenceImage", () => {
  it("POSTs the image to the reference-images endpoint and returns the id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "upload-9" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadReferenceImage(gifFile());

    expect(result).toEqual({ id: "upload-9" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/orders/reference-images?filename=clip.gif");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("image/gif");
  });

  it("rejects an unsupported file type before any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadReferenceImage(
        new File(["x"], "notes.txt", { type: "text/plain" }),
      ),
    ).rejects.toThrow(/JPEG, PNG, WEBP, or GIF/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the server's error message on a failed upload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "That image is too large." }), {
        status: 413,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadReferenceImage(gifFile())).rejects.toThrow(
      "That image is too large.",
    );
  });
});
