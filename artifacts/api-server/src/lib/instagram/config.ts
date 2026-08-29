// Where the Instagram integration reads its configuration.
//
// Env-only, deliberately: the access token is a secret, and secrets stay in
// Vercel rather than the atelier-editable Notion settings database (CLAUDE.md,
// "Studio Settings"). There is nothing here an atelier would want to retune —
// how many tiles the strip shows is a display decision that lives in the
// component, not a business tunable.
//
// Read fresh from `process.env` at call time, like every other config getter
// here, so tests can set and clear it without reloading the module.

/** The Graph host every Instagram call goes to. */
export const INSTAGRAM_GRAPH_BASE_URL = "https://graph.instagram.com";

/** The provider key this integration's stored token is filed under. */
export const INSTAGRAM_TOKEN_PROVIDER = "instagram";

/**
 * The long-lived access token the atelier pasted into Vercel.
 *
 * This is the SEED, not necessarily the token in use: once the nightly refresh
 * has run, the current token lives in Postgres and this is what that chain
 * descends from (see `token.ts`). Empty when the integration is not set up.
 */
export function instagramSeedToken(): string {
  return process.env.INSTAGRAM_ACCESS_TOKEN?.trim() ?? "";
}

/**
 * Whether the Instagram integration is configured at all.
 *
 * False ⇒ every read is a no-op returning an empty feed, and the strip does not
 * render. Note this asks about the SEED: a studio that deleted the env var but
 * still has a stored token is treated as having turned the feature off, which
 * is the reading that lets deleting the variable actually turn it off.
 */
export function instagramConfigured(): boolean {
  return instagramSeedToken().length > 0;
}

/** How many posts to ask Instagram for. The strip shows fewer than this — the
 * surplus is what absorbs posts dropped for having no usable image, so a run of
 * videos can't leave the grid short. Instagram caps a page at 100. */
export const INSTAGRAM_MEDIA_LIMIT = 24;
