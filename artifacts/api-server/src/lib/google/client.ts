// Thin Google Calendar REST client. Like the Notion client, config (a service-
// account key) is read at first use rather than module load, so the module
// imports without credentials and the client is injectable for tests.
//
// Auth is a Google Workspace **service account with domain-wide delegation**:
// the service account impersonates a staff member (the `subject`) to read their
// free/busy and write events *as* them — which is also what lets the booking
// invite the customer as a real attendee and attach a Google Meet link. The
// atelier authorizes the service account's client id for the Calendar scope in
// the Workspace Admin console (see `.env.example` / the memory note).

import { JWT } from "google-auth-library";

const CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";
const CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar"];

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

/** Read + validate the service-account JSON key from the environment. */
function readServiceAccountKey(): ServiceAccountKey {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY environment variable is not set",
    );
  }
  let parsed: Partial<ServiceAccountKey>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY is missing client_email or private_key",
    );
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

/**
 * The injectable seam. `fetch` mints a domain-wide-delegation access token for
 * the given staff `subjectEmail` and calls the Calendar API as that user. The
 * repository takes a `GoogleCalendarClient` so unit tests pass a fake without
 * touching Google.
 */
export interface GoogleCalendarClient {
  fetch(
    subjectEmail: string,
    path: string,
    init?: RequestInit,
  ): Promise<Response>;
}

function createGoogleCalendarClient(
  key: ServiceAccountKey,
): GoogleCalendarClient {
  // One impersonating JWT client per staff subject; each caches + refreshes its
  // own access token internally, so repeated calls don't re-mint tokens.
  const clients = new Map<string, JWT>();

  function clientFor(subject: string): JWT {
    let client = clients.get(subject);
    if (!client) {
      client = new JWT({
        email: key.client_email,
        key: key.private_key,
        scopes: CALENDAR_SCOPES,
        subject,
      });
      clients.set(subject, client);
    }
    return client;
  }

  return {
    async fetch(subjectEmail, path, init) {
      const { token } = await clientFor(subjectEmail).getAccessToken();
      if (!token) {
        throw new Error("Failed to obtain a Google Calendar access token");
      }
      return fetch(`${CALENDAR_BASE_URL}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(init?.headers as Record<string, string> | undefined),
        },
      });
    },
  };
}

let defaultClient: GoogleCalendarClient | null = null;

/** Lazily-constructed client reading the service-account key from the env. */
export function getGoogleCalendarClient(): GoogleCalendarClient {
  if (!defaultClient) {
    defaultClient = createGoogleCalendarClient(readServiceAccountKey());
  }
  return defaultClient;
}
