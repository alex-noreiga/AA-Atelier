import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { requiresAuthToken } from "@/lib/api-auth";

describe("requiresAuthToken", () => {
  it("authenticates the account and studio surfaces", () => {
    expect(requiresAuthToken("/api/account/overview")).toBe(true);
    expect(requiresAuthToken("/api/studio/access")).toBe(true);
    expect(requiresAuthToken("/api/studio/reviews/abc/status")).toBe(true);
  });

  it("leaves the public, edge-cached reads unauthenticated", () => {
    // These four set `s-maxage`; an Authorization header makes them uncacheable.
    expect(requiresAuthToken("/api/reviews")).toBe(false);
    expect(requiresAuthToken("/api/services")).toBe(false);
    expect(requiresAuthToken("/api/colors")).toBe(false);
    expect(requiresAuthToken("/api/products")).toBe(false);
  });

  it("ignores the query string", () => {
    expect(requiresAuthToken("/api/reviews?limit=6")).toBe(false);
    expect(requiresAuthToken("/api/studio/guides?section=general")).toBe(true);
  });

  it("handles an absolute URL, as an Expo bundle's setBaseUrl produces", () => {
    expect(
      requiresAuthToken("https://a3iceanddance.com/api/account/overview"),
    ).toBe(true);
    expect(requiresAuthToken("https://a3iceanddance.com/api/reviews")).toBe(
      false,
    );
  });

  it("does not match a prefix that is merely a string prefix", () => {
    expect(requiresAuthToken("/api/accounts-payable")).toBe(false);
    expect(requiresAuthToken("/api/studios")).toBe(false);
  });

  it("does not authenticate an order lookup", () => {
    // Order-scoped endpoints identify the customer by the email on the order,
    // not by a session, so they must stay cacheable/anonymous.
    expect(requiresAuthToken("/api/orders/ORD-000002")).toBe(false);
    expect(requiresAuthToken("/api/shop-orders/SHP-1")).toBe(false);
    expect(requiresAuthToken("/api/appointments/manage?token=x")).toBe(false);
  });
});

/**
 * Drift guard. The allowlist in `api-auth.ts` is a hand-maintained mirror of
 * which operations the server gates, so pin it to the contract: every operation
 * the spec marks `security: bearerAuth` must be one the client authenticates.
 * Without this, adding a gated endpoint outside `/account` or `/studio` would
 * ship a client that never sends its token and 401s in production.
 */
describe("the allowlist covers every bearerAuth operation in the spec", () => {
  const specPath = path.resolve(
    import.meta.dirname,
    "../../../lib/api-spec/openapi.yaml",
  );
  const spec = readFileSync(specPath, "utf8");

  /** Paths under `paths:` that carry at least one `bearerAuth` operation. */
  function securedPaths(yaml: string): string[] {
    const found = new Set<string>();
    let inPaths = false;
    let currentPath: string | null = null;

    for (const line of yaml.split("\n")) {
      if (/^paths:\s*$/.test(line)) {
        inPaths = true;
        continue;
      }
      if (!inPaths) continue;
      // A new top-level key ends the paths section.
      if (/^\S/.test(line)) break;

      const pathKey = /^ {2}(\/\S*):\s*$/.exec(line);
      if (pathKey) {
        currentPath = pathKey[1];
        continue;
      }
      if (currentPath && /^\s+-\s+bearerAuth:\s*\[\]\s*$/.test(line)) {
        found.add(currentPath);
      }
    }
    return [...found];
  }

  const paths = securedPaths(spec);

  it("finds the secured operations in the spec", () => {
    // Guards the scanner itself: a parse that silently found nothing would make
    // every assertion below vacuously pass.
    expect(paths.length).toBeGreaterThan(10);
    expect(paths).toContain("/account/overview");
  });

  it.each(paths)("authenticates %s", (path) => {
    expect(requiresAuthToken(`/api${path}`)).toBe(true);
  });
});
