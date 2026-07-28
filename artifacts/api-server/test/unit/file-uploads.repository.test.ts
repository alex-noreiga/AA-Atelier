import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { uploadImageToNotion } from "../../src/lib/notion/file-uploads.repository.js";

const image = {
  data: Buffer.from("fake-bytes"),
  filename: "inspo.jpg",
  contentType: "image/jpeg",
};

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.NOTION_API_KEY;
  process.env.NOTION_API_KEY = "secret-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (savedKey === undefined) delete process.env.NOTION_API_KEY;
  else process.env.NOTION_API_KEY = savedKey;
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("uploadImageToNotion", () => {
  it("creates a file upload then sends the bytes, returning the id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "upload-1",
          upload_url: "https://api.notion.com/v1/file_uploads/upload-1/send",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: "upload-1", status: "uploaded" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const id = await uploadImageToNotion(image);

    expect(id).toBe("upload-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Step 1: JSON create with auth + version headers.
    const [createUrl, createInit] = fetchMock.mock.calls[0];
    expect(createUrl).toBe("https://api.notion.com/v1/file_uploads");
    expect(createInit.method).toBe("POST");
    expect(createInit.headers).toMatchObject({
      Authorization: "Bearer secret-key",
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    });

    // Step 2: multipart send to the returned upload_url, no JSON content-type
    // (the runtime sets the multipart boundary from the FormData body).
    const [sendUrl, sendInit] = fetchMock.mock.calls[1];
    expect(sendUrl).toBe(
      "https://api.notion.com/v1/file_uploads/upload-1/send",
    );
    expect(sendInit.method).toBe("POST");
    expect(sendInit.headers).not.toHaveProperty("Content-Type");
    expect(sendInit.body).toBeInstanceOf(FormData);
  });

  it("falls back to the derived send URL when create omits upload_url", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "upload-2" }))
      .mockResolvedValueOnce(
        jsonResponse({ id: "upload-2", status: "uploaded" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await uploadImageToNotion(image);

    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.notion.com/v1/file_uploads/upload-2/send",
    );
  });

  it("throws when the create step fails (and never sends)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "bad" }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadImageToNotion(image)).rejects.toThrow(
      /file upload create failed with status 400/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the send step fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "upload-3" }))
      .mockResolvedValueOnce(new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadImageToNotion(image)).rejects.toThrow(
      /file upload send failed with status 500/,
    );
  });

  it("throws (without calling fetch) when NOTION_API_KEY is unset", async () => {
    delete process.env.NOTION_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadImageToNotion(image)).rejects.toThrow(
      /NOTION_API_KEY environment variable is not set/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
