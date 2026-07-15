// Test double for the injectable Resend client. `sendEmail`/`sendEmailBestEffort`
// both accept a `ResendClient` as their last argument (the seam this suite
// exercises), so tests drive them with a fully controlled `send` instead of
// touching the network — the exact analog of `fake-notion.ts`.

import type {
  EmailMessage,
  ResendClient,
} from "../../src/lib/resend/client.js";

export interface FakeResendClient extends ResendClient {
  /** Every message sent through this client, in order. */
  readonly calls: EmailMessage[];
}

type SendImpl = (message: EmailMessage) => Response | Promise<Response>;

/**
 * Build a fake client whose `send` delegates to `impl`. Records every message so
 * tests can assert on the request shape (recipient, subject, body).
 *
 * `hasApiKey`/`baseFrom` default off `configured` (the common case), but can be
 * overridden to exercise the split gate — e.g. an API key present with an empty
 * base `from`, where only a per-message `from` supplies the sender.
 */
export function makeFakeResendClient(
  impl: SendImpl = () => jsonResponse({ id: "email-id" }),
  configured = true,
  overrides: { hasApiKey?: boolean; baseFrom?: string } = {},
): FakeResendClient {
  const calls: EmailMessage[] = [];
  const hasApiKey = overrides.hasApiKey ?? configured;
  const baseFrom =
    overrides.baseFrom ??
    (configured ? "A.A Atelier <orders@a3iceanddance.com>" : "");
  return {
    configured,
    hasApiKey,
    baseFrom,
    calls,
    async send(message: EmailMessage): Promise<Response> {
      calls.push(message);
      return impl(message);
    },
  };
}

/** A JSON `Response` with the given status (defaults to 200/ok). */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A non-ok `Response` carrying a plain-text error body. */
export function errorResponse(status: number, text = "error"): Response {
  return new Response(text, { status });
}
