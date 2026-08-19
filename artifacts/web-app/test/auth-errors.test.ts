import { describe, it, expect } from "vitest";
import {
  parseAuthCallbackError,
  authErrorMessage,
  showsAuthErrorReference,
  DEFAULT_AUTH_ERROR_MESSAGE,
} from "@/lib/auth-errors";

describe("parseAuthCallbackError", () => {
  it("returns null when neither the query nor the hash carries an error", () => {
    expect(parseAuthCallbackError("", "")).toBeNull();
    expect(parseAuthCallbackError("?code=abc123", "")).toBeNull();
  });

  it("reads the error out of the query string", () => {
    expect(
      parseAuthCallbackError(
        "?error=server_error&error_description=Unable%20to%20exchange%20external%20code",
        "",
      ),
    ).toEqual({
      code: "server_error",
      description: "Unable to exchange external code",
    });
  });

  it("reads the error out of the hash fragment", () => {
    expect(
      parseAuthCallbackError("", "#error=access_denied&error_code=otp_expired"),
    ).toEqual({ code: "otp_expired", description: undefined });
  });

  it("prefers the specific error_code over the coarse error", () => {
    expect(
      parseAuthCallbackError(
        "?error=invalid_request&error_code=bad_oauth_state",
        "",
      )?.code,
    ).toBe("bad_oauth_state");
  });

  it("decodes a description that arrived as plus-separated words", () => {
    expect(
      parseAuthCallbackError(
        "?error=server_error&error_description=Something+broke",
        "",
      )?.description,
    ).toBe("Something broke");
  });

  it("prefers the query string when both carry an error", () => {
    expect(
      parseAuthCallbackError("?error=server_error", "#error=access_denied")
        ?.code,
    ).toBe("server_error");
  });
});

describe("authErrorMessage", () => {
  it("explains an expired link without blaming the customer", () => {
    expect(authErrorMessage("otp_expired")).toMatch(
      /expired or already been used/i,
    );
  });

  it("owns a provider-side failure rather than calling it an expired link", () => {
    const message = authErrorMessage("server_error");
    expect(message).toMatch(/on our end/i);
    expect(message).not.toMatch(/expired/i);
  });

  it("falls back to a neutral message for an unrecognized code", () => {
    expect(authErrorMessage("something_new_from_supabase")).toBe(
      DEFAULT_AUTH_ERROR_MESSAGE,
    );
    expect(authErrorMessage(null)).toBe(DEFAULT_AUTH_ERROR_MESSAGE);
  });
});

describe("showsAuthErrorReference", () => {
  it("hides the code for failures the customer can explain themselves", () => {
    expect(showsAuthErrorReference("expired")).toBe(false);
    expect(showsAuthErrorReference("access_denied")).toBe(false);
  });

  it("shows the code for failures that are ours to fix", () => {
    expect(showsAuthErrorReference("server_error")).toBe(true);
    expect(showsAuthErrorReference("validation_failed")).toBe(true);
    expect(showsAuthErrorReference("something_new_from_supabase")).toBe(true);
  });

  it("shows nothing when there is no error at all", () => {
    expect(showsAuthErrorReference(null)).toBe(false);
  });
});
