// Customer auth state, backed by Supabase Auth. Wraps the app (in App.tsx) and
// exposes the current session/user plus a `signOut`. It also wires the generated
// API client's Bearer-token seam to the Supabase access token — done once at
// module load — so every `/api/account/*` and `/api/studio/*` call carries
// `Authorization: Bearer <jwt>` and the server can verify the signed-in caller.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import {
  setAuthTokenGetter,
  getGetAccountOverviewQueryKey,
  getGetStudioAccessQueryKey,
} from "@workspace/api-client-react";
import { requiresAuthToken } from "./api-auth";
import { supabase, supabaseConfigured } from "./supabase";

// Wire the Bearer seam once, at module load. The getter runs before every API
// request and reads the current access token; supabase-js refreshes it under the
// hood, so a long-lived tab keeps sending a valid token. A build without
// Supabase configured simply never attaches one.
//
// It is scoped to the endpoints that actually verify a token (`requiresAuthToken`).
// An `Authorization` header makes a response uncacheable at Vercel's CDN, so
// attaching one to the public `s-maxage` reads sent every signed-in visitor
// through to a cold function instead of the edge. Declining early also skips the
// `getSession()` await on those calls.
setAuthTokenGetter(async ({ url }) => {
  if (!supabase || !requiresAuthToken(url)) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
});

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** True until the initial session lookup resolves (false when unconfigured). */
  loading: boolean;
  /** Whether Supabase Auth is configured for this build. */
  configured: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(supabaseConfigured);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      // Identity may have changed (sign in/out/token refresh across accounts) —
      // drop any cached overview so one customer's data can't leak to another,
      // and the staff answer with it, or a customer signing in after a staff
      // member on the same tab would keep being offered the studio link.
      queryClient.removeQueries({ queryKey: getGetAccountOverviewQueryKey() });
      queryClient.removeQueries({ queryKey: getGetStudioAccessQueryKey() });
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
    queryClient.removeQueries({ queryKey: getGetAccountOverviewQueryKey() });
    queryClient.removeQueries({ queryKey: getGetStudioAccessQueryKey() });
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        configured: supabaseConfigured,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within <AuthProvider>");
  }
  return ctx;
}
