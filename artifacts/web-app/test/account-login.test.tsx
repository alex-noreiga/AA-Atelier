import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Control the query string the page reads for the ?error=expired banner.
let mockSearch = "";
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return { ...actual, useSearch: () => mockSearch };
});

vi.mock("@workspace/api-client-react", () => ({
  useRequestMagicLink: vi.fn(),
}));

import { useRequestMagicLink } from "@workspace/api-client-react";
import AccountLogin from "@/pages/account-login";

const mockUse = vi.mocked(useRequestMagicLink);
const mutate = vi.fn();

beforeEach(() => {
  mockSearch = "";
  mutate.mockReset();
  // Invoke onSuccess synchronously so the "check your inbox" state is reachable.
  mockUse.mockImplementation(
    (opts) =>
      ({
        mutate: (vars: { data: { email: string } }) => {
          mutate(vars);
          opts?.mutation?.onSuccess?.(
            { message: "ok" } as never,
            vars as never,
            undefined as never,
            undefined as never,
          );
        },
        isPending: false,
      }) as never,
  );
});

describe("Account login", () => {
  it("submits the entered email to the magic-link mutation", async () => {
    const user = userEvent.setup();
    render(<AccountLogin />);

    await user.type(screen.getByTestId("input-email"), "skater@example.com");
    await user.click(screen.getByTestId("button-send-link"));

    expect(mutate).toHaveBeenCalledWith({
      data: { email: "skater@example.com" },
    });
  });

  it("shows a confirmation once the link has been sent", async () => {
    const user = userEvent.setup();
    render(<AccountLogin />);

    await user.type(screen.getByTestId("input-email"), "skater@example.com");
    await user.click(screen.getByTestId("button-send-link"));

    expect(screen.getByTestId("login-sent")).toBeInTheDocument();
    expect(screen.getByTestId("login-sent")).toHaveTextContent(
      "skater@example.com",
    );
  });

  it("shows an expired-link notice when arriving with ?error=expired", () => {
    mockSearch = "error=expired";
    render(<AccountLogin />);
    expect(screen.getByTestId("login-expired")).toBeInTheDocument();
  });
});
