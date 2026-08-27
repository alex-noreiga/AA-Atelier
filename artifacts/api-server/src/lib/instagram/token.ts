// Keeping the Instagram access token alive.
//
// This is the load-bearing part of the whole feature, and it is worth saying
// why it exists at all. Instagram issues long-lived tokens that expire **60
// days** after they are minted, and offers no permanent alternative. So the
// naive version of this feature — paste a token into Vercel, read the feed with
// it — works perfectly for two months and then stops, with no error anywhere: a
// 401 from Instagram degrades to an empty feed (correctly, see
// `media.repository.ts`), the strip stops rendering, and the site looks exactly
// as it does for a studio that never set the feature up. That is the failure
// this repo is least willing to ship.
//
// So the token renews itself. Instagram's `refresh_access_token` exchanges a
// still-valid long-lived token for a fresh 60-day one, and the answer is kept
// in Postgres because it is the only part of the stack that can be written at
// runtime — Vercel's environment cannot, and a credential does not belong in
// the atelier-editable Notion settings database.
//
// Three rules hold it together, and each is here to make a silent failure loud
// or impossible:
//
//   * **The env var is the seed and the last resort.** Reads prefer the stored
//     token while it is valid and fall back to `INSTAGRAM_ACCESS_TOKEN`
//     otherwise. A studio whose refresh has been broken long enough for the
//     stored token to lapse is fixed by pasting a fresh token into Vercel —
//     which is where they would look anyway — with no need to touch a database.
//   * **Changing the env var takes effect at once.** Without this, a pasted-in
//     replacement would do nothing until the stored chain expired weeks later,
//     which reads as the fix not working. Each stored row records a digest of
//     the seed its chain grew from; when that stops matching the env var, the
//     chain is abandoned and the new seed takes over.
//   * **A refresh that fails is alerted, not swallowed.** There are 46 days of
//     nightly retries between the refresh window opening and the token actually
//     expiring, so one bad night is nothing — but a run of them is the only
//     warning anyone gets before the feed dies, and it must reach a human.
//
// Deliberately NOT here: any attempt to mint a token from scratch. That needs
// an interactive Instagram login, so the first token is always pasted in by a
// person; this only keeps it alive afterwards.

import { createHash } from "node:crypto";
import { getDb, postgresConfigured } from "../db/client.js";
import {
  readIntegrationToken,
  writeIntegrationToken,
  type StoredIntegrationToken,
} from "../db/integration-tokens.repository.js";
import { logger } from "../logger.js";
import {
  INSTAGRAM_GRAPH_BASE_URL,
  INSTAGRAM_TOKEN_PROVIDER,
  instagramSeedToken,
} from "./config.js";

/** Refresh once the token is inside this many days of expiring. Generous on
 * purpose: at 14 days a nightly pass gets a fortnight of retries before the
 * credential actually lapses, so a week-long Instagram wobble costs nothing. */
const REFRESH_WITHIN_DAYS = 14;

/** Instagram refuses to refresh a token less than 24 hours old. Asking anyway
 * would turn every run in a freshly-seeded studio's first day into an alert
 * about a refusal that is entirely expected. */
const MIN_TOKEN_AGE_HOURS = 24;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

type FetchImpl = (
  url: string,
  init?: RequestInit,
) => Response | Promise<Response>;

/** Injectable seams — real env, Postgres and `fetch` by default, all replaced
 * in tests so no network and no database is touched. */
export interface InstagramTokenDeps {
  seedToken?: string;
  fetchImpl?: FetchImpl;
  read?: (provider: string) => Promise<StoredIntegrationToken | null>;
  write?: (token: {
    provider: string;
    accessToken: string;
    expiresAt: Date | null;
    seedFingerprint: string | null;
  }) => Promise<void>;
  /** Whether a token store is available at all. */
  storeConfigured?: () => boolean;
  now?: () => Date;
}

/**
 * A stable digest of a seed token, for noticing that the atelier pasted in a
 * different one. Truncated because only equality is ever asked of it, and a
 * value that is never used as a credential should not look like one.
 */
export function seedFingerprint(seed: string): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, 32);
}

function resolveDeps(deps: InstagramTokenDeps) {
  return {
    seedToken: deps.seedToken ?? instagramSeedToken(),
    fetchImpl: deps.fetchImpl ?? ((url, init) => fetch(url, init)),
    read:
      deps.read ??
      ((provider: string) => readIntegrationToken(provider, getDb())),
    write:
      deps.write ??
      ((token: {
        provider: string;
        accessToken: string;
        expiresAt: Date | null;
        seedFingerprint: string | null;
      }) => writeIntegrationToken(token, getDb())),
    storeConfigured: deps.storeConfigured ?? postgresConfigured,
    now: deps.now ?? (() => new Date()),
  };
}

/**
 * Whether a stored row is still usable — i.e. its chain grew from the seed
 * currently in the environment, and it has not expired.
 *
 * An **unknown** expiry (the vendor did not say) counts as usable: the token
 * was written by a successful refresh, so the evidence says it works, and
 * treating "we don't know" as "it's dead" would throw away a working credential
 * for a missing field.
 */
export function storedTokenUsable(
  stored: StoredIntegrationToken | null,
  seed: string,
  now: Date,
): boolean {
  if (!stored || !stored.accessToken) return false;
  if (stored.seedFingerprint !== seedFingerprint(seed)) return false;
  if (stored.expiresAt && stored.expiresAt.getTime() <= now.getTime()) {
    return false;
  }
  return true;
}

/**
 * The access token to read the feed with: the stored one while it is usable,
 * otherwise the seed from the environment. Empty string ⇒ the integration is
 * not configured and the caller serves an empty feed.
 *
 * A database failure resolves to the SEED rather than throwing. The feed is a
 * garnish, and falling back to a token that is probably still valid is a better
 * answer to a Postgres blip than no feed at all — the refresh pass, which does
 * care, reports its own failures separately.
 */
export async function currentInstagramToken(
  deps: InstagramTokenDeps = {},
): Promise<string> {
  const { seedToken, read, storeConfigured, now } = resolveDeps(deps);
  if (!seedToken) return "";
  if (!storeConfigured()) return seedToken;

  try {
    const stored = await read(INSTAGRAM_TOKEN_PROVIDER);
    return storedTokenUsable(stored, seedToken, now())
      ? stored!.accessToken
      : seedToken;
  } catch (err) {
    logger.warn(
      { err },
      "Could not read the stored Instagram token; falling back to the environment seed",
    );
    return seedToken;
  }
}

/** What one refresh attempt did, for the caller to report. */
export type InstagramRefreshStatus =
  /** Nothing to do: unconfigured, no store, too new, or not near expiry. */
  | "skipped"
  /** A fresh token was fetched and stored. */
  | "refreshed"
  /** Instagram or the database refused; the old token stands. */
  | "failed";

export interface InstagramRefreshResult {
  status: InstagramRefreshStatus;
  /** Why, in a sentence — what the pass logs and reports. */
  detail: string;
  /** The new expiry, when one was obtained. */
  expiresAt?: Date;
}

/** Whether a token this old and this close to expiry is due to be renewed. */
export function refreshDue(
  stored: StoredIntegrationToken | null,
  now: Date,
): boolean {
  // Nothing stored: the seed has never been renewed, so the chain starts now.
  // Its true age is unknown — the atelier may have pasted it in minutes ago —
  // which is why an "it's too new" refusal is skipped rather than alerted.
  if (!stored) return true;
  if (
    now.getTime() - stored.refreshedAt.getTime() <
    MIN_TOKEN_AGE_HOURS * HOUR_MS
  ) {
    return false;
  }
  // An unknown expiry is always due: we cannot prove there is time left, and a
  // needless refresh costs one request while a skipped one costs the feed.
  if (!stored.expiresAt) return true;
  return (
    stored.expiresAt.getTime() - now.getTime() <= REFRESH_WITHIN_DAYS * DAY_MS
  );
}

interface RefreshPayload {
  access_token?: unknown;
  expires_in?: unknown;
}

/**
 * Renew the Instagram token if it is due, and store the result.
 *
 * Idempotent in the way that matters: a second run on the same day finds the
 * token freshly refreshed and skips, so the nightly cron and a manual
 * reconciliation can both call it. Never throws — the caller is a cron pass
 * whose other work must not be lost to this one.
 */
export async function refreshInstagramToken(
  deps: InstagramTokenDeps = {},
): Promise<InstagramRefreshResult> {
  const { seedToken, fetchImpl, read, write, storeConfigured, now } =
    resolveDeps(deps);

  if (!seedToken) {
    return { status: "skipped", detail: "Instagram is not configured" };
  }
  if (!storeConfigured()) {
    // Without somewhere to put the answer there is no point asking the
    // question: the refreshed token would be forgotten the moment the function
    // instance froze, and the seed would expire on schedule anyway.
    return {
      status: "skipped",
      detail:
        "POSTGRES_URL is not set, so a refreshed token could not be stored; the Instagram feed will stop when the pasted token expires",
    };
  }

  const at = now();
  let stored: StoredIntegrationToken | null;
  try {
    stored = await read(INSTAGRAM_TOKEN_PROVIDER);
  } catch (err) {
    return {
      status: "failed",
      detail: `Could not read the stored Instagram token: ${String(err)}`,
    };
  }

  // A seed the atelier has just replaced starts a new chain from scratch, so
  // whatever was stored against the old one is not worth consulting.
  const usable = storedTokenUsable(stored, seedToken, at);
  const chain = usable ? stored : null;
  if (!refreshDue(chain, at)) {
    return {
      status: "skipped",
      detail: "The Instagram token is not near expiry",
    };
  }

  const token = usable ? stored!.accessToken : seedToken;
  let payload: RefreshPayload;
  try {
    // The token travels as a query parameter because that is the only form this
    // endpoint documents. Nothing here logs the URL — an error is reported from
    // its status, never its address — so the credential stays out of the logs.
    const response = await fetchImpl(
      `${INSTAGRAM_GRAPH_BASE_URL}/refresh_access_token` +
        `?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`,
      { method: "GET" },
    );
    if (!response.ok) {
      return {
        status: "failed",
        detail: `Instagram refused to refresh the access token (HTTP ${response.status})`,
      };
    }
    payload = (await response.json()) as RefreshPayload;
  } catch (err) {
    return {
      status: "failed",
      detail: `Could not reach Instagram to refresh the access token: ${String(err)}`,
    };
  }

  const accessToken =
    typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  if (!accessToken) {
    return {
      status: "failed",
      detail: "Instagram returned no access token when asked to refresh",
    };
  }

  const expiresIn =
    typeof payload.expires_in === "number" && payload.expires_in > 0
      ? payload.expires_in
      : null;
  const expiresAt = expiresIn
    ? new Date(at.getTime() + expiresIn * 1000)
    : null;

  try {
    await write({
      provider: INSTAGRAM_TOKEN_PROVIDER,
      accessToken,
      expiresAt,
      seedFingerprint: seedFingerprint(seedToken),
    });
  } catch (err) {
    // The token was renewed but not recorded, so the next run refreshes again
    // from the same starting point. Harmless: Instagram does not invalidate the
    // old token when it issues a new one.
    return {
      status: "failed",
      detail: `Refreshed the Instagram token but could not store it: ${String(err)}`,
    };
  }

  return {
    status: "refreshed",
    detail: expiresAt
      ? `Instagram access token refreshed; it now expires ${expiresAt.toISOString().slice(0, 10)}`
      : "Instagram access token refreshed",
    ...(expiresAt ? { expiresAt } : {}),
  };
}
