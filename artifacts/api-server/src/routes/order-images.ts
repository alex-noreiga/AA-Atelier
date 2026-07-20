// Binary upload endpoint for order reference / inspiration images.
//
// Deliberately OUTSIDE the OpenAPI contract and the generated client (like the
// Stripe webhook and the cron routes): it accepts raw image bytes, not JSON, so
// it can't be an orval-generated hook. It's mounted directly on the app in
// app.ts with `express.raw()` ahead of the JSON body parser.
//
// The browser POSTs one image at a time as the raw request body (the image's
// MIME type as Content-Type, the filename in a `?filename=` query), the handler
// relays it to Notion's File Upload API, and returns the resulting
// `file_upload` id. The client collects the ids and sends them in the order's
// `referenceImageIds`, which the order-create call attaches to the Notion page.

import type { Request, Response } from "express";
import { uploadImageToNotion } from "../lib/notion/file-uploads.repository.js";
import { logger } from "../lib/logger.js";

/** Image types we accept — the same set the frontend picker allows. */
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** Per-image cap. Kept under Vercel's ~4.5 MB serverless request-body limit;
 *  the browser downscales before upload so real uploads are far smaller. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const EXTENSION_FOR_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Derive a safe, extension-correct filename from the client-supplied name.
 *  `raw` is already narrowed to a plain string (or undefined) by the caller —
 *  a query param can otherwise be an array/object, so it's normalized at the
 *  request boundary before reaching any string operation. */
function safeFilename(raw: string | undefined, contentType: string): string {
  const ext = EXTENSION_FOR_TYPE[contentType] ?? "img";
  const base = (raw ?? "")
    .replace(/\.[^.]+$/, "") // drop any existing extension
    .replace(/[^a-zA-Z0-9-_ ]/g, "") // strip anything unusual
    .trim()
    .slice(0, 80);
  return `${base || "reference-image"}.${ext}`;
}

export async function uploadReferenceImageHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const contentType = (req.headers["content-type"] ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    res.status(400).json({
      error: "Unsupported image type. Please upload a JPEG, PNG, WEBP, or GIF.",
    });
    return;
  }

  // `req.body` is the raw Buffer from express.raw. Reject anything else first:
  // the explicit string/array checks (not just Buffer.isBuffer) rule out the
  // type confusion a tampered body could otherwise cause on the byte-length
  // comparison below — a string's `.length` counts characters, not bytes.
  const body = req.body;
  if (
    typeof body === "string" ||
    Array.isArray(body) ||
    !Buffer.isBuffer(body) ||
    body.length === 0
  ) {
    res.status(400).json({ error: "No image data was received." });
    return;
  }
  if (body.length > MAX_IMAGE_BYTES) {
    res
      .status(413)
      .json({ error: "That image is too large. Please keep it under 4 MB." });
    return;
  }

  // A query param can be a string, an array, or an object (parsed query) — take
  // it only when it's a plain string, so no array/object reaches safeFilename.
  const filenameParam =
    typeof req.query.filename === "string" ? req.query.filename : undefined;

  try {
    const id = await uploadImageToNotion({
      data: body,
      filename: safeFilename(filenameParam, contentType),
      contentType,
    });
    res.status(201).json({ id });
  } catch (err) {
    logger.error({ err }, "Reference image upload to Notion failed");
    res
      .status(502)
      .json({ error: "We couldn't upload that image. Please try again." });
  }
}
