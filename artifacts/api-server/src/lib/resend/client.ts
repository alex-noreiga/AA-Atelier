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

/** The message an email builder hands to the client. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Optional per-message sender. Overrides the client's base `from` so different
   * functions can send from different addresses (e.g. orders@ vs hello@). Falls
   * back to the base `from` when unset. See `config.ts` `fromAddress()`.
   */
  from?: string;
  /**
   * Optional Reply-To. Set on atelier-facing notifications so a reply goes
   * straight to the customer rather than back to the `from` address.
   */
  replyTo?: string;
}

export interface ResendClient {
  /** True when both an API key and a base "from" address are configured. */
  readonly configured: boolean;
  /** True when an API key is present (independent of the "from" address). */
  readonly hasApiKey: boolean;
  /**
   * The client's base sender, from `RESEND_FROM_EMAIL`. May be empty when only a
   * per-category override is set; a per-message `from` can then still supply the
   * sender (see `sendEmail`, which gates on the *resolved* sender, not this).
   */
  readonly baseFrom: string;
  send(message: EmailMessage): Promise<Response>;
}

export function createResendClient(config: ResendClientConfig): ResendClient {
  const { apiKey, from } = config;

  return {
    configured: Boolean(apiKey) && Boolean(from),
    hasApiKey: Boolean(apiKey),
    baseFrom: from,
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
          from: message.from || from,
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
