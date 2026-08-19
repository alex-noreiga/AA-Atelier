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
// 401, 403, offline, Supabase unconfigured — means no link. Failing closed
// costs a staff member one typed URL; failing open would advertise an internal
// surface to every customer.

import {
  useGetStudioAccess,
  getGetStudioAccessQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "./auth-context";

/**
 * True once the server has confirmed the current session is studio staff.
 *
 * Signed out it never asks — an anonymous probe can only ever be a 401, and the
 * navbar renders on every page. For the same reason the answer is treated as
 * good for the whole session (`staleTime: Infinity`): staff membership changes
 * when an env var does, not while someone is browsing, and the shared
 * `accountRateLimiter` counts this against the account overview's budget. A
 * refusal is not retried — a 403 is an answer, not a failure.
 */
export function useStudioAccess(): boolean {
  const { session, loading } = useAuth();

  const { data } = useGetStudioAccess({
    query: {
      queryKey: getGetStudioAccessQueryKey(),
      enabled: !loading && Boolean(session),
      retry: false,
      staleTime: Infinity,
      // A refused probe must not surface as an app-level error anywhere.
      throwOnError: false,
    },
  });

  return data?.staff === true;
}
