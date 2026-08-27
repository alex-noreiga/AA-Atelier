// Reading the studio's recent posts from the Instagram Graph API.
//
// Shaped like the Notion reads it sits beside — a TTL cache that falls back to
// the stale list on error — with two differences worth stating:
//
//   * **The TTL is five minutes, not sixty seconds.** Every other cached read
//     here is bounded by politeness; this one is bounded by a published quota
//     (200 calls per hour per user). The strip sits on the two busiest pages, so
//     a 60s TTL across a handful of warm serverless instances could plausibly
//     approach that ceiling — and a studio that trips it loses the feed for an
//     hour. Posts appear a few times a week, so five minutes costs nothing.
//   * **It never throws.** Portfolio distinguishes configuration (degrade) from
//     an outage (throw, and alert). There is no such split here, because every
//     way this read fails looks the same from outside and none of them is worth
//     a 500 on the home page: an expired token, a revoked permission, an
//     Instagram outage, a quota trip. The token expiry — the only one that
//     would otherwise go unnoticed forever — is watched by the refresh pass in
//     `token.ts`, which is where an alert about it belongs.

import { logger } from "../logger.js";
import {
  INSTAGRAM_GRAPH_BASE_URL,
  INSTAGRAM_MEDIA_LIMIT,
  instagramConfigured,
} from "./config.js";
import {
  extractInstagramPosts,
  INSTAGRAM_MEDIA_FIELDS,
  type InstagramMediaResponse,
  type InstagramPostRecord,
} from "./schema.js";
import { currentInstagramToken } from "./token.js";

const CACHE_TTL_MS = 5 * 60_000;

let cached: { posts: InstagramPostRecord[]; fetchedAt: number } | null = null;

type FetchImpl = (
  url: string,
  init?: RequestInit,
) => Response | Promise<Response>;

/** Injectable seams — the real token resolver and `fetch` by default. */
export interface InstagramMediaDeps {
  fetchImpl?: FetchImpl;
  token?: () => Promise<string>;
  configured?: () => boolean;
}

/** Test seam: drop the cached feed so a test's fake fetch is read afresh. */
export function __resetInstagramMediaCache(): void {
  cached = null;
}

/**
 * The studio's recent posts, newest first.
 *
 * Returns `[]` — never throws — for an unconfigured integration, a rejected
 * token, or an unreachable Instagram, with the stale list preferred over an
 * empty one whenever there is one. The caller renders nothing on an empty list,
 * so all of those read to a visitor as "the strip isn't there", which is the
 * right outcome for a section the pages must stand without.
 */
export async function listInstagramPosts(
  deps: InstagramMediaDeps = {},
): Promise<InstagramPostRecord[]> {
  const configured = deps.configured ?? instagramConfigured;
  if (!configured()) return [];

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.posts;
  }

  const doFetch: FetchImpl =
    deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const resolveToken = deps.token ?? (() => currentInstagramToken());

  try {
    const token = await resolveToken();
    if (!token) return cached?.posts ?? [];

    // Unversioned on purpose. A pinned Graph version is a dated bomb — Meta
    // sunsets them on a two-year cycle, and the day it goes the feed 400s with
    // nobody watching — whereas the unversioned path advances on its own. The
    // fields this asks for have been stable across every version of this API.
    const response = await doFetch(
      `${INSTAGRAM_GRAPH_BASE_URL}/me/media` +
        `?fields=${INSTAGRAM_MEDIA_FIELDS}` +
        `&limit=${INSTAGRAM_MEDIA_LIMIT}` +
        `&access_token=${encodeURIComponent(token)}`,
      { method: "GET" },
    );

    if (!response.ok) {
      // Reported by status alone: the URL carries the access token, so logging
      // it would put a live credential in the runtime logs.
      logger.warn(
        { status: response.status },
        "Instagram feed request failed; serving what we have",
      );
      return cached?.posts ?? [];
    }

    const payload = (await response.json()) as InstagramMediaResponse;
    const posts = extractInstagramPosts(payload);
    cached = { posts, fetchedAt: Date.now() };
    return posts;
  } catch (err) {
    logger.warn(
      { err },
      "Could not read the Instagram feed; serving what we have",
    );
    return cached?.posts ?? [];
  }
}
