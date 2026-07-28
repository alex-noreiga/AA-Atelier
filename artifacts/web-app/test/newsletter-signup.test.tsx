import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The signup asks only for an email. Mock the generated mutation to capture the
// submit payload and control the pending/success render states, no network.
const hoisted = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  isSuccess: false,
}));
vi.mock("@workspace/api-client-react", () => ({
  useSubscribeNewsletter: () => ({
    mutate: hoisted.mutate,
    isPending: hoisted.isPending,
    isSuccess: hoisted.isSuccess,
  }),
}));

import { NewsletterSignup } from "@/components/newsletter-signup";

beforeEach(() => {
  hoisted.isPending = false;
  hoisted.isSuccess = false;
});

describe("NewsletterSignup", () => {
  it("submits the email with the given source", async () => {
    const user = userEvent.setup();
    render(<NewsletterSignup source="footer" />);

    await user.type(
      screen.getByTestId("newsletter-email"),
      "grace@example.com",
    );
    await user.click(screen.getByTestId("newsletter-submit"));

    expect(hoisted.mutate).toHaveBeenCalledWith({
      data: { email: "grace@example.com", source: "footer" },
    });
  });

  it("shows an inline error and does not submit a malformed email", async () => {
    const user = userEvent.setup();
    render(<NewsletterSignup source="footer" />);

    await user.type(screen.getByTestId("newsletter-email"), "not-an-email");
    await user.click(screen.getByTestId("newsletter-submit"));

    expect(await screen.findByTestId("newsletter-error")).toBeInTheDocument();
    expect(hoisted.mutate).not.toHaveBeenCalled();
  });

  it("replaces the form with a confirmation once subscribed", () => {
    hoisted.isSuccess = true;
    render(<NewsletterSignup source="footer" />);

    expect(screen.getByTestId("newsletter-success")).toBeInTheDocument();
    expect(screen.queryByTestId("newsletter-form")).not.toBeInTheDocument();
  });
});
