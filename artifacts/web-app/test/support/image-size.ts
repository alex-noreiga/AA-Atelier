/**
 * Read an image's real pixel dimensions from its file header.
 *
 * Used by the tests that guard declared-versus-actual sizes — `og:image:width`
 * on a share image, `sizes=` on a favicon link. Both are claims the browser or
 * scraper trusts without checking, so a wrong one is invisible until it renders
 * badly somewhere we can't see. Reading the header keeps that honest without
 * pulling an image library into the dependency tree.
 */

import fs from "node:fs";

export interface ImageSize {
  width: number;
  height: number;
}

/** Width and height from a PNG's IHDR chunk, which is always the first chunk. */
export function pngSize(buf: Buffer): ImageSize {
  if (buf.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("Not a PNG (no IHDR chunk)");
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Width and height from a JPEG's start-of-frame segment. Walks the marker chain
 * rather than assuming a fixed offset, because the JFIF/EXIF headers that
 * precede the frame vary in length between encoders.
 */
export function jpegSize(buf: Buffer): ImageSize {
  let i = 2; // past the SOI marker
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1]!;
    const length = buf.readUInt16BE(i + 2);
    // Any SOF marker; 0xC4/0xC8/0xCC share the range but are DHT/JPG/DAC.
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      return {
        height: buf.readUInt16BE(i + 5),
        width: buf.readUInt16BE(i + 7),
      };
    }
    i += 2 + length;
  }
  throw new Error("No JPEG start-of-frame segment found");
}

/**
 * Every image packed into an .ico, from its directory entries. A dimension byte
 * of 0 means 256 — the format stores each side in a single byte.
 */
export function icoSizes(buf: Buffer): ImageSize[] {
  const count = buf.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => {
    const entry = 6 + i * 16;
    return { width: buf[entry] || 256, height: buf[entry + 1] || 256 };
  });
}

/** The dimensions of an image file, dispatched on its extension. */
export function imageSize(file: string): ImageSize {
  const buf = fs.readFileSync(file);
  if (file.endsWith(".png")) return pngSize(buf);
  if (file.endsWith(".ico")) {
    const sizes = icoSizes(buf);
    if (sizes.length === 0) throw new Error("Empty .ico");
    // Report the largest; callers that care about the full set use icoSizes.
    return sizes.reduce((a, b) => (b.width > a.width ? b : a));
  }
  return jpegSize(buf);
}
