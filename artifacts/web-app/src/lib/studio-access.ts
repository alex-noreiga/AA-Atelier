// Whether the signed-in account may use the internal studio dashboard.
//
// `/studio` is noindexed and deliberately not a public destination, but it was
// previously reachable *only* by typing the URL — so a staff member who didn't
// already know it had no way in. This is the middle ground: the navbar offers
// the link, but only to an account the server has confirmed is staff.
//
// The check is the server's, never the client's. The allowlist (and the
// requirement that the session came through Google) lives in env on the API
// side and is intentionally not shipped to the browser, so the only honest way
// to ask is to ask: a 200 from `/studio/access` means staff, anything else —
// 401, 403, 404, offline, Supabase unconfigured — means no link. Failing closed
// costs a staff member one typed URL; failing open would advertise an internal
// surface to every customer.
//
// The one refusal worth telling apart is the **403**: an allowlisted address
// turned away over the sign-in *method*. That is a staff member, and the fix —
// sign in again with Google — is a button on `/studio` that they will never
// see, because every door now routes them by staffhood and a 403 reads as "not
// staff" everywhere. So it is surfaced separately as `refused`, and `/account`
// hands those sessions to `/studio` to be told. The **404** stays folded into
// "not staff" exactly as before: there the whole point is that a customer who
// typed the URL learns nothing.

import {
  useGetStudioAccess,
  getGetStudioAccessQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "./auth-context";

export interface StudioAccess {
  /** True once the server has confirmed the current session is studio staff. */
  staff: boolean;
  /**
   * True when the server refused an allowlisted address over *how* it signed in
   * (a 403 — a password or magic-link session where Google is required). This
   * is not "not staff": it is a staff member one action away from the
   * dashboard, and the only page carrying that action is `/studio`. Kept apart
   * from the 404 refusal on purpose — that one really is a stranger, and must
   * stay indistinguishable from a URL that doesn't exist.
   */
  refused: boolean;
  /**
   * True while the answer is still unknown — the session hasn't resolved, or
   * the probe is in flight. Callers that *route* on staffhood (the account
   * portal, which hands a staff member to the dashboard instead) must wait for
   * this to clear, or a staff member sees a flash of the customer portal on
   * the way past. Callers that merely *offer* something (the navbar) can
   * ignore it and render the public set until the answer lands.
   */
  loading: boolean;
}

/**
 * Ask the server whether this session is studio staff.
 *
 * Signed out it never asks — an anonymous probe can only ever be a 401, and the
 * navbar renders on every page. For the same reason the answer is treated as
 * good for the whole session (`staleTime: Infinity`): staff membership changes
 * when an env var does, not while someone is browsing, and the shared
 * `accountRateLimiter` counts this against the account overview's budget. A
 * refusal is not retried — a 403 is an answer, not a failure.
 */
export function useStudioAccess(): StudioAccess {
  const { session, loading } = useAuth();
  const signedIn = !loading && Boolean(session);

  const access = useGetStudioAccess({
    query: {
      queryKey: getGetStudioAccessQueryKey(),
      enabled: signedIn,
      retry: false,
      staleTime: Infinity,
      // A refused probe must not surface as an app-level error anywhere.
      throwOnError: false,
    },
  });

  // The generated client rejects with the response status on `status`, the
  // same shape the account portal and `/studio` already read.
  const status = (access.error as { status?: number } | null)?.status;

  return {
    staff: access.data?.staff === true,
    refused: access.isError && status === 403,
    // `isLoading` is the first fetch in flight, and is false while the query is
    // disabled — so a signed-out visitor is answered immediately (not staff)
    // rather than left waiting on a request that will never be made.
    loading: loading || (signedIn && access.isLoading),
  };
}
