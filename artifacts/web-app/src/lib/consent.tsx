// Cookie / analytics consent. A single opt-in gate for all NON-ESSENTIAL
// tracking on the site — currently just Vercel Web Analytics (see
// components/analytics.tsx). Essential cookies (the account-portal session
// cookie set by the API) are strictly necessary and are never gated here; this
// context only governs analytics.
//
// The visitor's choice is persisted to localStorage so the banner is shown
// once. Until they choose, the status is "unset" and nothing non-essential
// loads — consent is opt-IN, not opt-out. A visitor can revisit the decision
// later (the "Manage cookie preferences" control on the privacy page calls
// `reset()`, which brings the banner back).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** The two decisions a visitor can make. */
export type ConsentChoice = "granted" | "denied";

/** `"unset"` = no choice made yet (banner should show). */
export type ConsentStatus = ConsentChoice | "unset";

interface ConsentContextValue {
  status: ConsentStatus;
  /** Opt in to non-essential analytics. */
  grant: () => void;
  /** Decline non-essential analytics. */
  deny: () => void;
  /** Clear the stored choice so the visitor is asked again. */
  reset: () => void;
}

const STORAGE_KEY = "aa-cookie-consent";

const ConsentContext = createContext<ConsentContextValue | null>(null);

function readStored(): ConsentStatus {
  if (typeof window === "undefined") return "unset";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === "granted" || raw === "denied" ? raw : "unset";
  } catch {
    // A blocked/unavailable localStorage just means we ask again this session.
    return "unset";
  }
}

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConsentStatus>(readStored);

  useEffect(() => {
    try {
      if (status === "unset") {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, status);
      }
    } catch {
      // Persistence is best-effort; the in-memory choice still holds this session.
    }
  }, [status]);

  const grant = useCallback(() => setStatus("granted"), []);
  const deny = useCallback(() => setStatus("denied"), []);
  const reset = useCallback(() => setStatus("unset"), []);

  const value = useMemo<ConsentContextValue>(
    () => ({ status, grant, deny, reset }),
    [status, grant, deny, reset],
  );

  return (
    <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>
  );
}

export function useConsent(): ConsentContextValue {
  const context = useContext(ConsentContext);
  if (!context) {
    throw new Error("useConsent must be used within a ConsentProvider");
  }
  return context;
}
