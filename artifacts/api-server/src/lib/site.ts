// The public site origin Stripe redirects back to after a payment. Read from
// the environment (not module load) so importing this needs no configuration.

export function siteBaseUrl(): string {
  const base = process.env.PUBLIC_BASE_URL;
  if (!base) {
    throw new Error("PUBLIC_BASE_URL environment variable is not set");
  }
  return base.replace(/\/+$/, "");
}
