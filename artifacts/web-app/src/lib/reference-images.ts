// Client-side helpers for reference / inspiration image uploads on the order
// form. Each image is downscaled in the browser (keeping phone photos well
// under the server's cap) and POSTed one at a time to the binary upload
// endpoint, which relays it to Notion and returns a `file_upload` id. The order
// form collects those ids and sends them as `referenceImageIds`.
//
// This bypasses the generated api-client (which is JSON-only) on purpose — the
// upload endpoint is a raw-bytes route outside the OpenAPI contract, the same
// way `custom-fetch.ts` is a hand-written layer. See the api-server route
// `routes/order-images.ts`.

/** MIME types the picker + server accept. */
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

/** `accept` attribute value for the file input. */
export const ACCEPT_ATTR = ACCEPTED_IMAGE_TYPES.join(",");

/** Most reference images a customer can attach to one order. */
export const MAX_REFERENCE_IMAGES = 6;

/** Longest edge (px) we downscale to before upload. */
const MAX_DIMENSION = 2000;

/** Hard client-side ceiling, matching the server's cap. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Re-encode target: try to land the JPEG under this before giving up quality. */
const TARGET_MAX_BYTES = 3.6 * 1024 * 1024;

export interface UploadedReferenceImage {
  /** The Notion file_upload id to send in the order's referenceImageIds. */
  id: string;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality),
  );
}

/**
 * Downscale + re-encode an image to a modestly sized JPEG. Falls back to the
 * original file when the browser can't decode it (e.g. an animated GIF, which
 * we don't want to flatten) or the canvas is unavailable — the caller still
 * enforces the size ceiling.
 */
async function prepareImage(file: File): Promise<Blob> {
  // Only re-encode the still-image types the browser reliably decodes; leave
  // GIFs alone so animation survives (size-gated by the caller).
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  const scale = Math.min(
    1,
    MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  // Step quality down until the encoded size is comfortable (or we run out).
  let encoded: Blob | null = null;
  for (const quality of [0.82, 0.7, 0.6]) {
    encoded = await canvasToBlob(canvas, quality);
    if (encoded && encoded.size <= TARGET_MAX_BYTES) break;
  }
  return encoded ?? file;
}

/**
 * Prepare and upload one reference image, returning its Notion file_upload id.
 * Throws an `Error` with a user-facing message on validation or transport
 * failure — the component surfaces `.message` inline.
 */
export async function uploadReferenceImage(
  file: File,
): Promise<UploadedReferenceImage> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as never)) {
    throw new Error("Please choose a JPEG, PNG, WEBP, or GIF image.");
  }

  const blob = await prepareImage(file);
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error("This image is too large. Please choose one under 4 MB.");
  }

  const contentType = blob.type || file.type || "image/jpeg";
  const response = await fetch(
    `/api/orders/reference-images?filename=${encodeURIComponent(file.name)}`,
    {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: blob,
    },
  );

  if (!response.ok) {
    let message = "Upload failed. Please try again.";
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new Error(message);
  }

  const data = (await response.json()) as UploadedReferenceImage;
  return data;
}
