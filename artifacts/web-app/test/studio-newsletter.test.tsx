// The newsletter panel. The generated hooks are mocked, so what's tested is the
// panel's own job: showing whether each opt-in actually reached the mailing
// list, offering Add only when that answer is a definite "no", and explaining an
// unknown column rather than leaving it bare.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";

const h = vi.hoisted(() => ({
  panel: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
  subscribe: vi.fn(),
  setState: vi.fn(),
  isPending: false,
}));

vi.mock("@workspace/api-client-react", () => ({
  useListNewsletterSignups: () => h.panel,
  useSubscribeNewsletterSignup: () => ({
    mutate: h.subscribe,
    isPending: h.isPending,
  }),
  useSetStudioRequestState: () => ({
    mutate: h.setState,
    isPending: h.isPending,
  }),
  getListNewsletterSignupsQueryKey: () => ["studio-newsletter"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { StudioNewsletter } from "@/components/studio-newsletter";

const subscribe = h.subscribe as unknown as Mock;
const setState = h.setState as unknown as Mock;

type Signup = Record<string, unknown>;

function signup(overrides: Signup = {}): Signup {
  return {
    id: "sign-1",
    email: "skater@example.com",
    source: "footer",
    subject: "Newsletter opt-in — footer",
    state: "new",
    subscription: "absent",
    submittedAt: "2026-08-01T12:00:00.000Z",
    notionUrl: "https://notion.so/sign-1",
    ...overrides,
  };
}

function withPanel(
  pending: Signup[],
  audience: Signup = { configured: true, contactCount: 3 },
  handled: Signup[] = [],
  truncated = false,
) {
  h.panel = {
    data: { pending, handled, audience, truncated },
    isLoading: false,
    isError: false,
    error: null,
  };
}

beforeEach(() => {
  h.isPending = false;
  subscribe.mockReset();
  setState.mockReset();
  withPanel([]);
});

describe("StudioNewsletter", () => {
  it("counts what still needs adding", () => {
    withPanel([signup()]);
    render(<StudioNewsletter />);
    expect(screen.getByTestId("newsletter-pending-count")).toHaveTextContent(
      "1 to add",
    );
    expect(screen.getByTestId("signup-subscription-sign-1")).toHaveTextContent(
      "Not on the list",
    );
  });

  it("adds an opt-in that isn't on the list", async () => {
    withPanel([signup()]);
    render(<StudioNewsletter />);

    await userEvent.click(screen.getByTestId("signup-add-sign-1"));

    expect(subscribe).toHaveBeenCalledWith(
      { signupId: "sign-1" },
      expect.anything(),
    );
  });

  // Add is only ever offered against a definite "not on the list".
  it("offers no Add button for someone already subscribed", () => {
    withPanel([signup({ subscription: "subscribed" })]);
    render(<StudioNewsletter />);

    expect(screen.queryByTestId("signup-add-sign-1")).toBeNull();
    expect(screen.getByTestId("signup-subscription-sign-1")).toHaveTextContent(
      "On the list",
    );
  });

  it("offers no Add button when the answer is unknown", () => {
    withPanel([signup({ subscription: "unknown" })], {
      configured: true,
      unreachable: true,
    });
    render(<StudioNewsletter />);

    expect(screen.queryByTestId("signup-add-sign-1")).toBeNull();
    expect(screen.getByTestId("newsletter-unreachable")).toBeInTheDocument();
  });

  it("says what to set when no audience is connected", () => {
    withPanel([signup({ subscription: "unknown" })], { configured: false });
    render(<StudioNewsletter />);

    expect(screen.getByTestId("newsletter-unconfigured")).toHaveTextContent(
      "RESEND_AUDIENCE_ID",
    );
    expect(screen.queryByTestId("signup-add-sign-1")).toBeNull();
  });

  it("dismisses a sign-up through the shared request-state operation", async () => {
    withPanel([signup()]);
    render(<StudioNewsletter />);

    await userEvent.click(screen.getByTestId("signup-dismiss-sign-1"));

    expect(setState).toHaveBeenCalledWith(
      { requestId: "sign-1", data: { state: "closed" } },
      expect.anything(),
    );
  });

  it("puts a filed sign-up back", async () => {
    withPanel([], { configured: true, contactCount: 3 }, [
      signup({ id: "sign-9", state: "closed", subscription: "subscribed" }),
    ]);
    render(<StudioNewsletter />);

    await userEvent.click(screen.getByTestId("signup-reopen-sign-9"));

    expect(setState).toHaveBeenCalledWith(
      { requestId: "sign-9", data: { state: "new" } },
      expect.anything(),
    );
  });

  // A row filed away that never reached the list is exactly what this panel is
  // for catching, so the status stays visible after it's been dealt with.
  it("keeps showing the audience status on already-filed rows", () => {
    withPanel([], { configured: true, contactCount: 3 }, [
      signup({ id: "sign-9", state: "closed", subscription: "absent" }),
    ]);
    render(<StudioNewsletter />);

    expect(screen.getByTestId("signup-subscription-sign-9")).toHaveTextContent(
      "Not on the list",
    );
  });

  it("shows the server's reason when an add is refused", async () => {
    subscribe.mockImplementation((_vars, opts) =>
      opts.onError({
        data: { error: "No Resend audience is configured." },
      }),
    );
    withPanel([signup()]);
    render(<StudioNewsletter />);

    await userEvent.click(screen.getByTestId("signup-add-sign-1"));

    expect(screen.getByTestId("signup-error-sign-1")).toHaveTextContent(
      "No Resend audience is configured.",
    );
  });

  it("reports a failed read rather than an empty list", () => {
    h.panel = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { data: { error: "Notion is unreachable." } },
    };
    render(<StudioNewsletter />);
    expect(screen.getByTestId("newsletter-error")).toHaveTextContent(
      "Notion is unreachable.",
    );
  });
});
