// Relays a single small file to Notion's File Upload API and returns the
// resulting `file_upload` id, which callers attach to a page: a customer's
// reference image (see `orders.blocks.ts`, which references it from an `image`
// block) or the invoice PDF the server renders for the atelier (see
// `attachInvoicePdf` in `invoice.repository.ts`, which puts it on a `files`
// property).
//
// This deliberately does NOT go through the shared `NotionClient` (client.ts):
// that client hardcodes `Content-Type: application/json`, but the upload "send"
// step is `multipart/form-data` whose boundary must be set by the runtime. So
// this module talks to Notion directly, mirroring the client's lazy
// env-at-first-use auth pattern.
//
// The flow is two calls (single-part upload, files ≤ 20 MB):
//   1. POST /v1/file_uploads              (JSON)      → { id, upload_url }
//   2. POST /v1/file_uploads/{id}/send    (multipart) → status "uploaded"
// A completed upload must be attached within an hour and can be attached once —
// the order-create call that follows this does exactly that.

const NOTION_VERSION = "2022-06-28";
const NOTION_BASE_URL = "https://api.notion.com";

/** A prepared file ready to relay to Notion. */
export interface NotionFileUpload {
  /** The raw file bytes. */
  data: Buffer;
  /** A filename for the upload (shown in Notion). */
  filename: string;
  /** The file's MIME type, e.g. "image/jpeg" or "application/pdf". */
  contentType: string;
}

/** The image case, kept under its original name for the upload route. */
export type NotionImageUpload = NotionFileUpload;

function requireApiKey(): string {
  // Trimmed for the same reason as `createNotionClient`: a pasted env value can
  // carry a trailing newline, which is an invalid header value.
  const key = process.env.NOTION_API_KEY?.trim();
  if (!key) {
    throw new Error("NOTION_API_KEY environment variable is not set");
  }
  return key;
}

interface CreatedFileUpload {
  id: string;
  /** The endpoint to POST the file bytes to; equals /v1/file_uploads/{id}/send. */
  upload_url?: string;
}

/**
 * Upload one file to Notion and return its `file_upload` id. Throws on any
 * non-2xx from either step so the caller (the upload route, or the invoice
 * PDF tool) can turn it into an error response.
 */
export async function uploadFileToNotion(
  image: NotionFileUpload,
): Promise<string> {
  const apiKey = requireApiKey();
  const authHeaders = {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": NOTION_VERSION,
  };

  // 1. Create the (pending) file upload object.
  const createResponse = await fetch(`${NOTION_BASE_URL}/v1/file_uploads`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "single_part",
      filename: image.filename,
      content_type: image.contentType,
    }),
  });
  if (!createResponse.ok) {
    throw new Error(
      `Notion file upload create failed with status ${createResponse.status}: ${await createResponse.text()}`,
    );
  }
  const created = (await createResponse.json()) as CreatedFileUpload;

  // 2. Send the bytes. No Content-Type header — passing FormData lets the
  //    runtime set `multipart/form-data` with the correct boundary.
  const form = new FormData();
  // Copy into a plain Uint8Array — a Node Buffer isn't directly a BlobPart
  // under strict lib types (its backing buffer is ArrayBufferLike).
  form.append(
    "file",
    new Blob([new Uint8Array(image.data)], { type: image.contentType }),
    image.filename,
  );
  const sendUrl =
    created.upload_url ??
    `${NOTION_BASE_URL}/v1/file_uploads/${created.id}/send`;
  const sendResponse = await fetch(sendUrl, {
    method: "POST",
    headers: authHeaders,
    body: form,
  });
  if (!sendResponse.ok) {
    throw new Error(
      `Notion file upload send failed with status ${sendResponse.status}: ${await sendResponse.text()}`,
    );
  }

  return created.id;
}

/** The image case, kept under its original name for the upload route. */
export const uploadImageToNotion = uploadFileToNotion;
