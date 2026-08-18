import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Control the query string the page reads for the ?error=expired banner.
let mockSearch = "";
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return { ...actual, useSearch: () => mockSearch };
});

// Fake Supabase auth surface — the page calls these directly. Hoisted so the
// vi.mock factory (which runs before top-level init) can close over it.
const { auth } = vi.hoisted(() => ({
  auth: {
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signInWithOtp: vi.fn(),
    signInWithOAuth: vi.fn(),
    resetPasswordForEmail: vi.fn(),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { auth },
  supabaseConfigured: true,
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    session: null,
    user: null,
    loading: false,
    configured: true,
    signOut: vi.fn(),
  }),
}));

import AccountLogin from "@/pages/account-login";

beforeEach(() => {
  mockSearch = "";
  Object.values(auth).forEach((fn) => fn.mockReset());
  auth.signInWithPassword.mockResolvedValue({
    data: { session: {} },
    error: null,
  });
  auth.signUp.mockResolvedValue({
    data: { session: null, user: {} },
    error: null,
  });
  auth.signInWithOtp.mockResolvedValue({ error: null });
  auth.signInWithOAuth.mockResolvedValue({ error: null });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
});

describe("Account login", () => {
  it("signs in with email + password", async () => {
    const user = userEvent.setup();
    render(<AccountLogin />);

    await user.type(screen.getByTestId("input-email"), "skater@example.com");
    await user.type(screen.getByTestId("input-password"), "hunter2000");
    await user.click(screen.getByTestId("button-submit"));

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "skater@example.com",
      password: "hunter2000",
    });
  });

  it("requests a magic link and shows the confirmation", async () => {
    const user = userEvent.setup();
    render(<AccountLogin />);

    await user.type(screen.getByTestId("input-email"), "skater@example.com");
    await user.click(screen.getByTestId("button-magic-link"));

    expect(auth.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: "skater@example.com" }),
    );
    expect(await screen.findByTestId("login-notice")).toHaveTextContent(
      "skater@example.com",
    );
  });

  it("creates an account and shows the verify-your-email notice", async () => {
    const user = userEvent.setup();
    render(<AccountLogin />);

    await user.click(screen.getByTestId("tab-signup"));
    await user.type(screen.getByTestId("input-email"), "new@example.com");
    await user.type(screen.getByTestId("input-password"), "hunter2000");
    await user.click(screen.getByTestId("button-submit"));

    expect(auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new@example.com",
        password: "hunter2000",
      }),
    );
    expect(await screen.findByTestId("login-notice")).toBeInTheDocument();
  });

  it("sends a password reset from the forgot-password action", async () => {
    const user = userEvent.setup();
    render(<AccountLogin />);

    await user.type(screen.getByTestId("input-email"), "skater@example.com");
    await user.click(screen.getByTestId("button-forgot"));

    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
      "skater@example.com",
      expect.objectContaining({
        redirectTo: expect.stringContaining("/account/reset"),
      }),
    );
  });

  it("starts Google OAuth", async () => {
    const user = userEvent.setup();
    render(<AccountLogin />);

    await user.click(screen.getByTestId("button-google"));

    expect(auth.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google" }),
    );
  });

  it("shows an expired-link notice when arriving with ?error=expired", () => {
    mockSearch = "error=expired";
    render(<AccountLogin />);
    expect(screen.getByTestId("login-expired")).toBeInTheDocument();
  });
});
