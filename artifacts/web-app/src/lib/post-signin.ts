// Where to send someone after they finish signing in.
//
// The OAuth / magic-link round trip lands on `/account/callback`, which by
// default forwards to the customer dashboard. That's wrong for a staff member
// who was sent to sign in with Google *from* `/studio` — they'd have to find
// their way back. So the page that starts the sign-in parks its destination
// here, and the callback picks it up.
//
// It's deliberately NOT carried in the redirect URL: a `?next=` on the Supabase
// redirect would both need the URL added to Supabase's redirect allow-list and
// hand a stranger a parameter to aim wherever they like. `sessionStorage` keeps
// it same-tab, same-origin, and out of anyone else's reach.
//
// The path is still validated on the way out — belt and braces. Only a single
// leading slash passes, so `//evil.example.com` (a protocol-relative URL, which
// a router would happily treat as off-site) and any absolute URL are refused.

const STORAGE_KEY = "aa-post-signin";

/** Whether a stored value is a safe same-origin path to navigate to. */
function isSafePath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

/** Remember where to land after sign-in completes. A non-path is ignored. */
export function setPostSignInPath(path: string): void {
  if (!isSafePath(path)) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, path);
  } catch {
    // Private-mode / storage-disabled browsers just fall back to the default
    // destination — not worth failing a sign-in over.
  }
}

/** Read and clear the stored destination, or null when there isn't a safe one. */
export function takePostSignInPath(): string | null {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
    return stored && isSafePath(stored) ? stored : null;
  } catch {
    return null;
  }
}
