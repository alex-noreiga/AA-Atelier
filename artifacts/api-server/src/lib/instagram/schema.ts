// Pure mapping between Instagram's Graph payloads and the shapes this app
// serves — no I/O, so every rule below is unit-testable directly.
//
// Two jobs: turning a media node into a post, and turning a URL into the key
// two posts are matched on.

/** What kind of post it is, in the contract's vocabulary. */
export type InstagramMediaKind = "image" | "video" | "carousel";

/** One post, as `GET /instagram` serves it (before the shop join adds its
 * `productId`). */
export interface InstagramPostRecord {
  id: string;
  permalink: string;
  imageUrl: string;
  mediaType: InstagramMediaKind;
  caption?: string;
  postedAt?: string;
}

/** A media node as `GET /me/media` returns it — only the fields we ask for. */
export interface InstagramMediaNode {
  id?: unknown;
  caption?: unknown;
  media_type?: unknown;
  media_url?: unknown;
  permalink?: unknown;
  thumbnail_url?: unknown;
  timestamp?: unknown;
}

export interface InstagramMediaResponse {
  data?: unknown;
}

/** The fields to request. Kept beside the node type so the two can't drift into
 * asking for something nothing reads, or reading something nothing asked for. */
export const INSTAGRAM_MEDIA_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_url",
  "permalink",
  "thumbnail_url",
  "timestamp",
].join(",");

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Instagram's `IMAGE` / `VIDEO` / `CAROUSEL_ALBUM`, in our words.
 *
 * An unrecognized type reads as `image`, not as a reason to drop the post: the
 * badge is decoration, and Instagram adding a fourth media kind should widen
 * the strip's contents rather than silently empty it. Every post carries a
 * still whatever its type, so the fallback always renders correctly.
 */
export function mediaKind(rawType: unknown): InstagramMediaKind {
  switch (text(rawType).toUpperCase()) {
    case "VIDEO":
      return "video";
    case "CAROUSEL_ALBUM":
      return "carousel";
    default:
      return "image";
  }
}

/**
 * The still to render for a node.
 *
 * For a video Instagram puts the poster frame in `thumbnail_url` and the actual
 * MP4 in `media_url`, so taking `media_url` first would put a video file in an
 * `<img>` — a blank tile, not an error. Hence thumbnail first for a video and
 * `media_url` for everything else (a carousel's `media_url` is its first item).
 */
export function stillUrl(node: InstagramMediaNode): string {
  const thumbnail = text(node.thumbnail_url);
  const media = text(node.media_url);
  return mediaKind(node.media_type) === "video"
    ? thumbnail || media
    : media || thumbnail;
}

/**
 * Map a media list into posts, newest first (Instagram's own order, preserved).
 *
 * A node with no id, no permalink, or no usable still is DROPPED rather than
 * served: each of those makes a tile that is broken in a way the visitor can
 * see — no key, nowhere to click, or an empty square — and a strip of the
 * atelier's work is better one tile shorter than visibly broken.
 */
export function extractInstagramPosts(
  payload: InstagramMediaResponse,
): InstagramPostRecord[] {
  const nodes = Array.isArray(payload.data)
    ? (payload.data as InstagramMediaNode[])
    : [];

  const posts: InstagramPostRecord[] = [];
  for (const node of nodes) {
    const id = text(node.id);
    const permalink = text(node.permalink);
    const imageUrl = stillUrl(node);
    if (!id || !permalink || !imageUrl) continue;

    const caption = text(node.caption);
    const postedAt = text(node.timestamp);
    posts.push({
      id,
      permalink,
      imageUrl,
      mediaType: mediaKind(node.media_type),
      ...(caption ? { caption } : {}),
      ...(postedAt ? { postedAt } : {}),
    });
  }
  return posts;
}

/** Matches the shortcode in any Instagram post URL: `/p/`, `/reel/`, `/reels/`
 * or the older `/tv/`, whether or not the account name precedes it. */
const SHORTCODE_PATTERN = /\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/;

/**
 * The shortcode a post URL identifies, or null when it names no post.
 *
 * This — not the URL — is what the feed and the inventory row are matched on,
 * because the same post is reachable under several addresses that are all
 * "correct": Instagram serves a reel under both `/reel/` and `/p/`, the share
 * sheet appends an `?igsh=` tracking parameter, the profile-scoped permalink
 * inserts the account name, and any of them may or may not end in a slash.
 * Comparing URLs would make the join depend on which button the atelier
 * happened to copy from, and fail silently when they chose differently.
 *
 * Anything that isn't recognizable as a post URL — a profile link, a blank, a
 * typo — yields null, so the piece simply isn't linked to a post. That is the
 * safe direction: the cost is a tile that links to Instagram instead of the
 * shop, against the cost of pointing "Shop this piece" at the wrong garment.
 */
export function instagramShortcode(url: string): string | null {
  const match = SHORTCODE_PATTERN.exec(url.trim());
  return match ? match[1] : null;
}
