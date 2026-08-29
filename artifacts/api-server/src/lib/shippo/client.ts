// Thin Shippo REST client. The API token is read at first use rather than at
// module load, mirroring `lib/notion/client.ts` and `lib/stripe/client.ts`, so
// the server — and the tests — can import this module without credentials.
//
// Raw `fetch` rather than the vendor SDK, matching the Notion and Google
// adapters: the flow uses two endpoints, the SDK would be the largest dependency
// added for the smallest surface, and `minimumReleaseAge` makes a vendor SDK
// bump a thing to wait a day for. The injectable `ShippoClient` seam is what the
// tests drive, exactly like `NotionClient`.
//
// Get a token at https://apps.goshippo.com/settings/api. A **test** token
// (`shippo_test_…`) buys fake labels against fake carrier accounts and costs
// nothing, which is what local development and Preview should carry.

const SHIPPO_BASE_URL = "https://api.goshippo.com";
/** Pinned, so a Shippo default-version change can't reshape a response mid-flight. */
const SHIPPO_API_VERSION = "2018-02-08";

export interface ShippoClient {
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

let client: ShippoClient | null = null;

function apiToken(): string | undefined {
  const token = process.env.SHIPPO_API_KEY?.trim();
  return token ? token : undefined;
}

/**
 * Whether a label can be bought at all.
 *
 * Unset ⇒ the whole feature reports itself unconfigured and says so, rather than
 * throwing at the point of sale. Same shape as the settings editor's
 * unconfigured database and the materials panel's unset id: a state only a human
 * can clear is said plainly, never rendered as an empty result.
 */
export function shippoConfigured(): boolean {
  return apiToken() !== undefined;
}

/**
 * Whether the configured token is Shippo's **test** token.
 *
 * Surfaced all the way to the dashboard, and it earns the trip: a test label
 * looks exactly like a real one — it has a tracking number, a PDF, and a price —
 * but no carrier has ever heard of it. An atelier who sticks one on a parcel
 * finds out when the customer doesn't get their dress. Read from the token's own
 * prefix rather than a second env var, so the two can't disagree about which
 * mode the app is in.
 */
export function shippoTestMode(): boolean {
  return apiToken()?.startsWith("shippo_test") ?? false;
}

/** The lazily-constructed client, reading the token from the environment. */
export function getShippoClient(): ShippoClient {
  if (!client) {
    client = {
      async fetch(path: string, init?: RequestInit): Promise<Response> {
        const token = apiToken();
        if (!token) {
          throw new Error("SHIPPO_API_KEY environment variable is not set");
        }
        return fetch(`${SHIPPO_BASE_URL}${path}`, {
          ...init,
          headers: {
            Authorization: `ShippoToken ${token}`,
            "Shippo-API-Version": SHIPPO_API_VERSION,
            "Content-Type": "application/json",
            ...(init?.headers as Record<string, string> | undefined),
          },
        });
      },
    };
  }
  return client;
}

/** Test seams, mirroring the Notion and Supabase adapters. */
export function __setShippoClientForTests(fake: ShippoClient | null): void {
  client = fake;
}

export function __resetShippoClient(): void {
  client = null;
}
