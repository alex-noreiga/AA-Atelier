// Thin Twilio REST client — the SMS counterpart of `lib/resend/client.ts`, and
// shaped after it deliberately: config (credentials + the sending identity) is
// read at composition time rather than at module load, so the client is
// injectable for testing and the server can import this module without
// credentials. The same rationale as the Notion and Resend clients.
//
// Raw `fetch` against the REST API rather than the `twilio` npm package, which
// is the house style for every vendor here (Notion, Google, Stripe's webhook
// verification aside). Sending one text is a form-encoded POST with basic auth;
// the SDK would be the largest dependency in the app for that, against the
// repo's pruned-dependencies rule.
//
// Auth: `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`. The sending identity is
// EITHER `TWILIO_MESSAGING_SERVICE_SID` (preferred — a US A2P 10DLC campaign is
// registered against a Messaging Service, and it is what lets Twilio pick a
// number from the pool and handle STOP/HELP on the studio's behalf) OR a single
// `TWILIO_FROM_NUMBER` in E.164. The service wins when both are set.

const TWILIO_BASE_URL = "https://api.twilio.com";

interface TwilioClientConfig {
  accountSid: string;
  authToken: string;
  /** A Messaging Service SID (`MG…`), preferred over a bare number. */
  messagingServiceSid: string;
  /** A single sending number in E.164 (`+15125550123`). */
  fromNumber: string;
}

/** The message an SMS builder hands to the client. */
export interface SmsMessage {
  /** The recipient in E.164 (`+15125550123`) — normalized by the caller. */
  to: string;
  /** The text itself. Plain, single-part where it can be. */
  body: string;
}

export interface TwilioClient {
  /** True when credentials AND a sending identity are configured. */
  readonly configured: boolean;
  /** True when both credentials are present (independent of the sender). */
  readonly hasCredentials: boolean;
  /** True when either a Messaging Service or a from-number is set. */
  readonly hasSender: boolean;
  send(message: SmsMessage): Promise<Response>;
}

export function createTwilioClient(config: TwilioClientConfig): TwilioClient {
  const { accountSid, authToken, messagingServiceSid, fromNumber } = config;
  const hasCredentials = Boolean(accountSid) && Boolean(authToken);
  const hasSender = Boolean(messagingServiceSid) || Boolean(fromNumber);

  return {
    configured: hasCredentials && hasSender,
    hasCredentials,
    hasSender,
    async send(message: SmsMessage): Promise<Response> {
      if (!hasCredentials) {
        throw new Error(
          "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN environment variables are not set",
        );
      }
      // Form-encoded, not JSON — Twilio's REST API predates the convention and
      // rejects a JSON body.
      const form = new URLSearchParams({ To: message.to, Body: message.body });
      if (messagingServiceSid) {
        form.set("MessagingServiceSid", messagingServiceSid);
      } else {
        form.set("From", fromNumber);
      }

      return fetch(
        `${TWILIO_BASE_URL}/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
        },
      );
    },
  };
}

let defaultClient: TwilioClient | null = null;

/**
 * Lazily-constructed client reading credentials from the environment. Deferring
 * construction to first use keeps env reads out of module load and lets tests
 * inject their own client before this is ever called.
 */
export function getTwilioClient(): TwilioClient {
  if (!defaultClient) {
    defaultClient = createTwilioClient({
      accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
      authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID ?? "",
      fromNumber: process.env.TWILIO_FROM_NUMBER ?? "",
    });
  }
  return defaultClient;
}

/** Test seam: inject a fake client (mirrors the Notion/Supabase seams). */
export function __setTwilioClientForTests(client: TwilioClient | null): void {
  defaultClient = client;
}

/** Test seam: drop the memoized client so the next call re-reads the env. */
export function __resetTwilioClient(): void {
  defaultClient = null;
}

/** Whether SMS is wired up at all. Every send path self-gates on this, so an
 * install that never configured Twilio behaves exactly as it did before SMS
 * existed — the same degrade-to-off contract as the optional Notion databases. */
export function smsConfigured(): boolean {
  return getTwilioClient().configured;
}
