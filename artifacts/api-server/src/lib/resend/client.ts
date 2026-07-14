// Thin Resend REST client. Config (API key + verified "from" address) is read
// at composition time rather than at module load, so the client is injectable
// for testing and the server can import this module without requiring
// credentials — the same rationale as the Notion client in `notion/client.ts`.
//
// Auth: the atelier's `RESEND_API_KEY` and `RESEND_FROM_EMAIL` come from
// environment variables. Get a key at https://resend.com/api-keys; the "from"
// address must belong to a domain verified in the Resend dashboard.

const RESEND_BASE_URL = "https://api.resend.com";

interface ResendClientConfig {
  apiKey: string;
  from: string;
}

/** The message an email builder hands to the client; `from` is supplied here. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Optional Reply-To. Set on atelier-facing notifications so a reply goes
   * straight to the customer rather than back to the `from` address.
   */
  replyTo?: string;
}

export interface ResendClient {
  /** True when both an API key and a "from" address are configured. */
  readonly configured: boolean;
  send(message: EmailMessage): Promise<Response>;
}

export function createResendClient(config: ResendClientConfig): ResendClient {
  const { apiKey, from } = config;

  return {
    configured: Boolean(apiKey) && Boolean(from),
    async send(message: EmailMessage): Promise<Response> {
      if (!apiKey) {
        throw new Error("RESEND_API_KEY environment variable is not set");
      }
      return fetch(`${RESEND_BASE_URL}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
      });
    },
  };
}

let defaultClient: ResendClient | null = null;

/**
 * Lazily-constructed client reading credentials from the environment. Deferring
 * construction to first use keeps env reads out of module load and lets tests
 * inject their own client before this is ever called.
 */
export function getResendClient(): ResendClient {
  if (!defaultClient) {
    defaultClient = createResendClient({
      apiKey: process.env.RESEND_API_KEY ?? "",
      from: process.env.RESEND_FROM_EMAIL ?? "",
    });
  }
  return defaultClient;
}

/**
 * The atelier's own inbox for internal new-submission notifications
 * (`ATELIER_INBOX_EMAIL`, e.g. `orders@a3iceanddance.com`). Empty string when
 * unset — callers skip the notification rather than send to nobody. Read fresh
 * each call (no memoization) so it can't be affected by first-use ordering.
 */
export function getAtelierInbox(): string {
  return process.env.ATELIER_INBOX_EMAIL ?? "";
}
