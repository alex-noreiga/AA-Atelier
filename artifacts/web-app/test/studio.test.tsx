import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Mock } from "vitest";

// Render <Redirect> as a marker so the unauthenticated bounce is assertable,
// and capture the imperative navigation the sign-out does.
const navigate = vi.hoisted(() => vi.fn());
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return {
    ...actual,
    Redirect: ({ to }: { to: string }) => (
      <div data-testid="redirect">{to}</div>
    ),
    useLocation: () => ["/studio", navigate],
  };
});

// Mutable auth state the mocked useAuth reads (set per test).
const h = vi.hoisted(() => ({
  session: null as unknown,
  user: null as unknown,
  loading: false,
  signOut: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    session: h.session,
    user: h.user,
    loading: h.loading,
    configured: true,
    signOut: h.signOut,
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetStudioAnalytics: vi.fn(),
  getGetStudioAnalyticsQueryKey: () => ["studio-analytics"],
  // The moderation queue, the internal tools panel, and the working-hours
  // editor ride along at the bottom of the dashboard; each has its own test
  // file, so here they just need inert hooks to render.
  useRunStudioTool: () => ({ mutate: vi.fn(), isPending: false }),
  useListStaffAvailability: () => ({
    data: { entries: [], staff: [] },
    isLoading: false,
    isError: false,
    error: null,
  }),
  useCreateStaffAvailability: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateStaffAvailability: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteStaffAvailability: () => ({ mutate: vi.fn(), isPending: false }),
  getListStaffAvailabilityQueryKey: () => ["studio-availability"],
  useListStudioReviews: () => ({
    data: { pending: [], decided: [] },
    isLoading: false,
    isError: false,
    error: null,
  }),
  useSetStudioReviewStatus: () => ({ mutate: vi.fn(), isPending: false }),
  getListStudioReviewsQueryKey: () => ["studio-reviews"],
}));

// The 403 panel offers a Google re-sign-in, which drives supabase-js directly.
const sb = vi.hoisted(() => ({
  signOut: vi.fn().mockResolvedValue({ error: null }),
  signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
}));
vi.mock("@/lib/supabase", () => ({
  supabaseConfigured: true,
  supabase: { auth: sb },
}));

import { useGetStudioAnalytics } from "@workspace/api-client-react";
import Studio from "@/pages/studio";

const mockAnalytics = vi.mocked(useGetStudioAnalytics) as unknown as Mock;

const refetch = vi.fn();

/** The handful of query fields the page reads. */
function stubAnalytics(state: {
  data?: unknown;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  isFetching?: boolean;
}): void {
  mockAnalytics.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    error: state.error ?? null,
    isFetching: state.isFetching ?? false,
    refetch,
  } as never);
}

function renderPage() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Studio />
    </QueryClientProvider>,
  );
}

const analytics = {
  generatedAt: "2026-08-18T15:04:00.000Z",
  customOrders: {
    total: 5,
    active: 3,
    completed: 1,
    cancelled: 1,
    stages: [
      { stage: "Consultation", count: 1 },
      { stage: "Sewing", count: 2 },
      { stage: "Delivered", count: 0 },
    ],
  },
  shopOrders: {
    total: 4,
    active: 2,
    completed: 2,
    cancelled: 0,
    stages: [
      { stage: "Payment Confirmed", count: 1 },
      { stage: "Shipped", count: 1 },
    ],
  },
  production: {
    activeOrders: 3,
    scheduled: 2,
    unscheduled: 1,
    overdue: 1,
    dueThisWeek: 1,
    dueThisMonth: 2,
    rush: 1,
    upcoming: [
      {
        orderNumber: "ORD-1",
        orderName: "Aurora — Custom Dress",
        stage: "Sewing",
        dueDate: "2026-08-01",
        overdue: true,
        rush: true,
      },
      {
        orderNumber: "ORD-2",
        orderName: "Juniper — Custom Dress",
        stage: "Consultation",
        dueDate: "2026-08-22",
        overdue: false,
      },
    ],
  },
  revenue: [
    {
      month: "2026-07",
      shopRevenue: 120,
      shopOrders: 3,
      customBooked: 800,
      customOrders: 1,
    },
    {
      month: "2026-08",
      shopRevenue: 240,
      shopOrders: 4,
      customBooked: 1600,
      customOrders: 2,
    },
  ],
  payments: {
    invoicedTotal: 2400,
    collectedTotal: 900,
    outstandingTotal: 1500,
    depositsCollected: 900,
    depositsOutstanding: 300,
    balancesCollected: 0,
    balancesOutstanding: 1200,
    invoiceCount: 3,
    unpaidInvoiceCount: 2,
  },
  topItems: [
    { name: "Bow Soaker", orders: 6 },
    { name: "Blade Towel", orders: 2 },
  ],
};

beforeEach(() => {
  h.session = { access_token: "jwt" };
  h.user = { email: "alexandra@a3iceanddance.com" };
  h.loading = false;
  h.signOut.mockReset();
  h.signOut.mockResolvedValue(undefined);
  navigate.mockReset();
});

describe("studio dashboard — access", () => {
  it("redirects to sign-in when there's no session", () => {
    h.session = null;
    stubAnalytics({});
    renderPage();
    expect(screen.getByTestId("redirect")).toHaveTextContent("/account/login");
  });

  it("redirects to sign-in on a 401", () => {
    stubAnalytics({ isError: true, error: { status: 401 } });
    renderPage();
    expect(screen.getByTestId("redirect")).toHaveTextContent("/account/login");
  });

  it("shows a signed-in customer the ordinary Not Found page, not a refusal", () => {
    // The server answers 404 for a non-staff account on purpose; anything that
    // reads as "access denied" would confirm the dashboard exists to someone
    // who only typed the URL.
    stubAnalytics({ isError: true, error: { status: 404 } });
    renderPage();

    expect(screen.getByTestId("link-home")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("studio-forbidden")).not.toBeInTheDocument();
    expect(screen.queryByTestId("redirect")).not.toBeInTheDocument();
  });

  it("leaks nothing about the studio on that page", () => {
    stubAnalytics({ isError: true, error: { status: 404 } });
    const { container } = renderPage();

    expect(container.textContent ?? "").not.toMatch(/studio|dashboard|staff/i);
  });

  it("tells a staff member who used the wrong sign-in method, without redirecting", () => {
    stubAnalytics({ isError: true, error: { status: 403 } });
    renderPage();
    expect(screen.getByTestId("studio-forbidden")).toBeInTheDocument();
    expect(screen.queryByTestId("redirect")).not.toBeInTheDocument();
  });

  it("shows the server's own reason for a 403, so a wrong sign-in method says so", () => {
    stubAnalytics({
      isError: true,
      error: {
        status: 403,
        data: {
          error:
            "Studio access requires signing in with Google. Please sign out and use Continue with Google.",
        },
      },
    });
    renderPage();
    expect(screen.getByTestId("studio-forbidden")).toHaveTextContent(
      /requires signing in with Google/,
    );
  });

  it("re-signs-in with Google from the 403 panel, dropping the stale session first", async () => {
    stubAnalytics({ isError: true, error: { status: 403 } });
    renderPage();

    await userEvent.click(screen.getByTestId("button-studio-google"));

    expect(sb.signOut).toHaveBeenCalled();
    expect(sb.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google" }),
    );
    // And it comes back here rather than the customer dashboard.
    expect(window.sessionStorage.getItem("aa-post-signin")).toBe("/studio");
  });

  it("shows a spinner while loading", () => {
    stubAnalytics({ isLoading: true });
    renderPage();
    expect(screen.getByTestId("studio-loading")).toBeInTheDocument();
  });

  it("shows an error state on any other failure", () => {
    stubAnalytics({ isError: true, error: { status: 500 } });
    renderPage();
    expect(screen.getByTestId("studio-error")).toBeInTheDocument();
  });
});

describe("studio dashboard — figures", () => {
  beforeEach(() => stubAnalytics({ data: analytics }));

  it("leads with the headline numbers", () => {
    renderPage();
    expect(screen.getByTestId("stat-active")).toHaveTextContent("3");
    expect(screen.getByTestId("stat-overdue")).toHaveTextContent("1");
    expect(screen.getByTestId("stat-outstanding")).toHaveTextContent("$1,500");
    // The most recent month in the series is "this month".
    expect(screen.getByTestId("stat-shop-month")).toHaveTextContent("$240");
  });

  it("lists the nearest-due orders and marks the overdue one", () => {
    renderPage();
    const upcoming = screen.getByTestId("upcoming-orders");
    expect(upcoming).toHaveTextContent("Aurora — Custom Dress");
    expect(upcoming).toHaveTextContent("Overdue");
    expect(upcoming).toHaveTextContent("Juniper — Custom Dress");
  });

  it("renders both pipelines with their stage counts", () => {
    renderPage();
    expect(screen.getByTestId("pipeline-custom")).toHaveTextContent(
      "Consultation",
    );
    expect(screen.getByTestId("pipeline-custom")).toHaveTextContent(
      "5 on record",
    );
    expect(screen.getByTestId("pipeline-shop")).toHaveTextContent("Shipped");
  });

  it("shows the two revenue series separately, never summed", () => {
    renderPage();
    const panel = screen.getByTestId("panel-revenue");
    expect(panel).toHaveTextContent("Shop taken $360");
    expect(panel).toHaveTextContent("Custom booked $2,400");
  });

  it("breaks payments into deposits and balances", () => {
    renderPage();
    const panel = screen.getByTestId("panel-payments");
    expect(panel).toHaveTextContent("Deposits collected");
    expect(panel).toHaveTextContent("$900");
    expect(panel).toHaveTextContent("Balances due");
    expect(panel).toHaveTextContent("$1,200");
  });

  it("lists the best sellers", () => {
    renderPage();
    expect(screen.getByTestId("panel-top-items")).toHaveTextContent(
      "Bow Soaker",
    );
  });

  it("explains an empty best-seller list rather than showing a blank panel", () => {
    stubAnalytics({ data: { ...analytics, topItems: [] } });
    renderPage();
    expect(screen.getByTestId("panel-top-items")).toHaveTextContent(
      /No item-level figures yet/,
    );
  });

  it("refetches on demand", async () => {
    renderPage();
    await userEvent.click(screen.getByTestId("button-refresh"));
    expect(refetch).toHaveBeenCalled();
  });

  it("is titled Dashboard, and names who is signed in", () => {
    renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("studio-email")).toHaveTextContent(
      "alexandra@a3iceanddance.com",
    );
  });

  it("signs out from here — staff have no account portal to do it from", async () => {
    renderPage();

    await userEvent.click(screen.getByTestId("button-sign-out"));

    expect(h.signOut).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/account/login");
  });

  it("still offers sign-out when the figures fail to load", async () => {
    // `/account` sends staff back here, so an unreadable dashboard without this
    // is a dead end.
    stubAnalytics({ isError: true, error: { status: 500 } });
    renderPage();

    expect(screen.getByTestId("studio-error")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-sign-out"));

    expect(h.signOut).toHaveBeenCalled();
  });
});
