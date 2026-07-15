// Vercel Blob client-upload token endpoint for the order form's reference
// images/videos. Files are uploaded directly from the browser to Vercel Blob
// (bypassing the ~4.5 MB serverless request-body limit); this route only issues
// the short-lived client token that authorizes each upload. The browser then
// sends the resulting Blob URLs to `POST /api/orders`, which attaches them to
// the order in Notion.
//
// Like the Stripe webhook and the cron endpoint, this is deliberately NOT part
// of the OpenAPI contract / generated client — it speaks Vercel Blob's
// client-upload protocol, not the browser API. It's mounted directly on the app.

import type { Request, Response } from "express";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { logger } from "../lib/logger.js";

// Reference material only: photos and short clips. Anything else is rejected
// before a token is issued.
const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
];
const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB per file

export async function uploadOrderRefsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(503).json({ error: "File uploads are not configured." });
    return;
  }

  try {
    const result = await handleUpload({
      body: req.body as HandleUploadBody,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ALLOWED_CONTENT_TYPES,
        maximumSizeInBytes: MAX_SIZE_BYTES,
        addRandomSuffix: true,
      }),
      // The browser passes the returned URLs to POST /api/orders, which attaches
      // them — there's nothing to persist here. Vercel invokes this callback from
      // its own servers (it can't reach localhost in dev, which is harmless).
      onUploadCompleted: async () => {},
    });
    res.json(result);
  } catch (err) {
    logger.warn({ err }, "Blob client-upload token request failed");
    res.status(400).json({ error: (err as Error).message });
  }
}
