import { test, expect } from "@playwright/test";
import { connect } from "node:tls";
import { URL } from "node:url";

// An expired TLS certificate takes the ENTIRE site down harder than any Notion
// or Google outage — browsers refuse to load it — and it's a silent time-bomb
// that no page-render or API smoke would warn about ahead of time. This spec
// opens a raw TLS connection to the smoke target and fails if the certificate
// has already expired OR expires within the warning window, so the atelier gets
// weeks of lead time to renew instead of a hard outage.
//
// Read-only and dependency-free (Node's built-in `tls`). Skipped automatically
// for non-HTTPS targets (e.g. a local http:// preview).

// How many days out counts as "renew now". Auto-renewing certs (Vercel/Let's
// Encrypt) rotate well inside this, so a real alarm here means renewal is stuck.
const WARN_WITHIN_DAYS = 14;

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://a3iceanddance.com";

test.describe("Production smoke: TLS certificate", () => {
  test(`certificate is valid and not expiring within ${WARN_WITHIN_DAYS} days`, async () => {
    const url = new URL(BASE_URL);
    test.skip(
      url.protocol !== "https:",
      `Target ${BASE_URL} is not HTTPS — no certificate to check.`,
    );

    const host = url.hostname;
    const port = url.port ? Number(url.port) : 443;

    const validTo = await new Promise<Date>((resolve, reject) => {
      const socket = connect(
        { host, port, servername: host, timeout: 15_000 },
        () => {
          const cert = socket.getPeerCertificate();
          socket.end();
          if (!cert || !cert.valid_to) {
            reject(new Error("No peer certificate returned"));
            return;
          }
          resolve(new Date(cert.valid_to));
        },
      );
      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error("TLS connection timed out"));
      });
      socket.on("error", reject);
    });

    expect(
      Number.isNaN(validTo.getTime()),
      "certificate had an unparseable expiry date",
    ).toBe(false);

    const msRemaining = validTo.getTime() - Date.now();
    const daysRemaining = Math.floor(msRemaining / 86_400_000);

    expect(
      daysRemaining,
      `TLS certificate for ${host} expires in ${daysRemaining} day(s) ` +
        `(on ${validTo.toISOString()}) — renew it.`,
    ).toBeGreaterThan(WARN_WITHIN_DAYS);
  });
});
