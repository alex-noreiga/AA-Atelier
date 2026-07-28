import { describe, it, expect, vi, afterEach } from "vitest";
import { uploadReferenceImage } from "@/lib/reference-images";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A GIF file skips the canvas re-encode path (which jsdom can't run), so it
// exercises the upload transport directly.
function gifFile(size = 1024): File {
  return new File([new Uint8Array(size)], "clip.gif", { type: "image/gif" });
}

function jpegFile(name = "photo.jpg"): File {
  return new File([new Uint8Array(1024)], name, { type: "image/jpeg" });
}

function okFetch(id = "upload-1") {
  const mock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
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

  it("rejects an over-cap image before any request", async () => {
    const fetchMock = okFetch();
    // A GIF isn't re-encoded (animation is preserved), so its own size is what
    // the client-side cap checks — 5 MB is over the 4 MB ceiling.
    const bigGif = new File([new Uint8Array(5 * 1024 * 1024)], "big.gif", {
      type: "image/gif",
    });

    await expect(uploadReferenceImage(bigGif)).rejects.toThrow(/under 4 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("uploadReferenceImage image preparation", () => {
  it("uploads the original when the browser can't decode the image", async () => {
    const fetchMock = okFetch("upload-decode");
    // A still-image type that createImageBitmap can't decode falls back to the
    // original bytes rather than failing the upload.
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("decode failed")),
    );

    const result = await uploadReferenceImage(jpegFile("sketch.jpg"));

    expect(result).toEqual({ id: "upload-decode" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/orders/reference-images?filename=sketch.jpg");
    expect(init.headers["Content-Type"]).toBe("image/jpeg");
  });

  it("uploads the original when no 2D canvas context is available", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 3000, height: 2000, close: vi.fn() }),
    );
    // No drawing surface ⇒ prepareImage bails to the original file.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    await uploadReferenceImage(jpegFile());

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].headers["Content-Type"]).toBe(
      "image/jpeg",
    );
  });

  it("downscales a large image and steps quality down until it fits", async () => {
    const fetchMock = okFetch("upload-encoded");
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 4000, height: 3000, close }),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    // First two quality levels stay over the ~3.6 MB target; the third fits, so
    // the loop should stop after exactly three encodes (0.82 → 0.7 → 0.6).
    const sizes = [4_000_000, 3_800_000, 1_000_000];
    let call = 0;
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation(function (cb: BlobCallback) {
        const size = sizes[call++] ?? 1000;
        cb({ size, type: "image/jpeg" } as Blob);
      });

    const result = await uploadReferenceImage(jpegFile());

    expect(result).toEqual({ id: "upload-encoded" });
    expect(toBlob).toHaveBeenCalledTimes(3);
    // The re-encoded JPEG (not the original file) is what gets uploaded.
    expect(fetchMock.mock.calls[0][1].body).toEqual({
      size: 1_000_000,
      type: "image/jpeg",
    });
    expect(close).toHaveBeenCalledOnce();
  });
});
