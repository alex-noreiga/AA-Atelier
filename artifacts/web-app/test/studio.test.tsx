import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Mock } from "vitest";

// Render <Redirect> as a marker so the unauthenticated bounce is assertable,
// and capture the imperative navigation the sign-out does.
const navigate = vi.hoisted(() => vi.fn());
const loc = vi.hoisted(() => ({ path: "/studio" }));
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return {
    ...actual,
    Redirect: ({ to }: { to: string }) => (
      <div data-testid="redirect">{to}</div>
    ),
    useLocation: () => [loc.path, navigate],
  };
});

// Mutable auth state the mocked useAuth reads (set per test).
const h = vi.hoisted(() => ({
  session: null as unknown,
  user: null as unknown,
  loading: false,
  signOut: vi.fn(),
}));
// The page gates on the staff probe, not on the figures — the probe reads
// nothing and the navbar has already cached it, so the gate costs no request
// and a section that isn't the figures doesn't have to fetch them to render.
const gate = vi.hoisted(() => ({
  staff: true,
  refused: false,
  failed: false,
  loading: false,
  status: undefined as number | undefined,
  reason: undefined as string | undefined,
}));
vi.mock("@/lib/studio-access", () => ({ useStudioAccess: () => gate }));

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
  // Refresh reads this to leave the staff probe alone; the page never calls
  // the probe hook itself (`@/lib/studio-access` is mocked above).
  getGetStudioAccessQueryKey: () => ["/api/studio/access"],
  // The materials panel, the moderation queue, the request queue, the newsletter
  // panel, the settings editor, the internal tools panel, and the working-hours
  // and appointment-staffing editors ride along at the bottom of the dashboard;
  // each has its own test file, so here they just need inert hooks to render.
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
  useGetAppointmentStaffing: () => ({
    data: {
      configured: true,
      staff: [],
      types: [],
      usingDefaults: true,
    },
    isLoading: false,
    isError: false,
    error: null,
  }),
  useSetAppointmentStaffing: () => ({ mutate: vi.fn(), isPending: false }),
  getGetAppointmentStaffingQueryKey: () => ["studio-appointment-staff"],
  useListStudioReviews: () => ({
    data: { pending: [], decided: [] },
    isLoading: false,
    isError: false,
    error: null,
  }),
  useGetStudioGuides: () => ({
    data: { guides: [], sections: [], configured: true },
    isLoading: false,
    isError: false,
    error: null,
  }),
  getGetStudioGuidesQueryKey: () => ["studio-guides"],
  useSetStudioReviewStatus: () => ({ mutate: vi.fn(), isPending: false }),
  getListStudioReviewsQueryKey: () => ["studio-reviews"],
  useListStudioRequests: () => ({
    data: { open: [], closed: [] },
    isLoading: false,
    isError: false,
    error: null,
  }),
  useSetStudioRequestState: () => ({ mutate: vi.fn(), isPending: false }),
  getListStudioRequestsQueryKey: () => ["studio-requests"],
  useListNewsletterSignups: () => ({
    data: { pending: [], handled: [], audience: { configured: true } },
    isLoading: false,
    isError: false,
    error: null,
  }),
  useSubscribeNewsletterSignup: () => ({ mutate: vi.fn(), isPending: false }),
  getListNewsletterSignupsQueryKey: () => ["studio-newsletter"],
  useGetStudioMaterials: () => ({
    data: {
      lowStock: [],
      untracked: [],
      suppressedCount: 0,
      totalCount: 0,
      configured: true,
    },
    isLoading: false,
    isError: false,
    error: null,
  }),
  getGetStudioMaterialsQueryKey: () => ["studio-materials"],
  useGetStudioSettings: () => ({
    data: { configured: true, settings: [], unknownRows: [] },
    isLoading: false,
    isError: false,
    error: null,
  }),
  useSetStudioSetting: () => ({ mutate: vi.fn(), isPending: false }),
  getGetStudioSettingsQueryKey: () => ["studio-settings"],
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
import { STUDIO_SECTIONS } from "@/lib/studio-sections";

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

/** The query client the page ran against, so a test can watch what Refresh
 * does to it. */
let client: QueryClient;

function renderPage() {
  client = new QueryClient();
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
      customCollected: 300,
      customOrders: 1,
    },
    {
      month: "2026-08",
      shopRevenue: 240,
      shopOrders: 4,
      customBooked: 1600,
      customCollected: 450,
      customOrders: 2,
    },
  ],
  paymentLedger: { configured: true, payments: 5, recordedFrom: "2026-07" },
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
  topItemCoverage: { counted: 7, unlinked: 0 },
  channels: [
    { channel: "Etsy", orders: 3, revenue: 210 },
    { channel: "Online Store", orders: 4, revenue: 150 },
    { channel: "Skate Shop", orders: 0, revenue: 0 },
  ],
  consignment: {
    configured: true,
    openPlacements: 2,
    atShopUnits: 7,
    atShopRetail: 245,
    settledUnits: 3,
    settledPayout: 52.5,
    payoutUnknownPlacements: 0,
    items: [{ name: "Bow Soaker", atShop: 7, sold: 3 }],
  },
  capacity: {
    open: true,
    reason: "under-capacity" as const,
    limit: 8,
    inProduction: 5,
  },
};

beforeEach(() => {
  loc.path = "/studio";
  gate.staff = true;
  gate.refused = false;
  gate.failed = false;
  gate.loading = false;
  gate.status = undefined;
  gate.reason = undefined;
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
    gate.staff = false;
    gate.status = 401;
    renderPage();
    expect(screen.getByTestId("redirect")).toHaveTextContent("/account/login");
  });

  it("shows a signed-in customer the ordinary Not Found page, not a refusal", () => {
    // The server answers 404 for a non-staff account on purpose; anything that
    // reads as "access denied" would confirm the dashboard exists to someone
    // who only typed the URL.
    gate.staff = false;
    gate.status = 404;
    renderPage();

    expect(screen.getByTestId("link-home")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("studio-forbidden")).not.toBeInTheDocument();
    expect(screen.queryByTestId("redirect")).not.toBeInTheDocument();
  });

  it("leaks nothing about the studio on that page", () => {
    gate.staff = false;
    gate.status = 404;
    const { container } = renderPage();

    expect(container.textContent ?? "").not.toMatch(/studio|dashboard|staff/i);
  });

  it("tells a staff member who used the wrong sign-in method, without redirecting", () => {
    gate.staff = false;
    gate.refused = true;
    gate.status = 403;
    renderPage();
    expect(screen.getByTestId("studio-forbidden")).toBeInTheDocument();
    expect(screen.queryByTestId("redirect")).not.toBeInTheDocument();
  });

  it("shows the server's own reason for a 403, so a wrong sign-in method says so", () => {
    gate.staff = false;
    gate.refused = true;
    gate.status = 403;
    gate.reason =
      "Studio access requires signing in with Google. Please sign out and use Continue with Google.";
    renderPage();
    expect(screen.getByTestId("studio-forbidden")).toHaveTextContent(
      /requires signing in with Google/,
    );
  });

  it("re-signs-in with Google from the 403 panel, dropping the stale session first", async () => {
    gate.staff = false;
    gate.refused = true;
    gate.status = 403;
    renderPage();

    await userEvent.click(screen.getByTestId("button-studio-google"));

    expect(sb.signOut).toHaveBeenCalled();
    expect(sb.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google" }),
    );
    // And it comes back here rather than the customer dashboard.
    expect(window.sessionStorage.getItem("aa-post-signin")).toBe("/studio");
  });

  it("shows a spinner while the staff check is in flight", () => {
    gate.loading = true;
    gate.staff = false;
    stubAnalytics({});
    renderPage();
    expect(screen.getByTestId("studio-loading")).toBeInTheDocument();
  });

  it("says the check itself failed rather than calling a staff member a stranger", () => {
    // An outage is not a refusal. Rendering Not Found here would tell someone
    // who IS staff that they aren't — untrue, and nothing they can act on.
    gate.staff = false;
    gate.failed = true;
    gate.status = 500;
    stubAnalytics({});
    renderPage();

    expect(screen.getByTestId("studio-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("link-home")).not.toBeInTheDocument();
  });

  it("keeps a confirmed staff member in when a later probe hiccups", () => {
    // The answer is cached for the session, so a failed refetch must not evict
    // somebody the server has already vouched for.
    gate.staff = true;
    gate.failed = true;
    gate.status = 500;
    stubAnalytics({ data: analytics });
    renderPage();

    expect(screen.getByTestId("studio-view-figures")).toBeInTheDocument();
    expect(screen.queryByTestId("studio-unavailable")).not.toBeInTheDocument();
  });

  it("refreshes the data, not the door", async () => {
    // Re-asking the gate on Refresh would put the whole dashboard behind a
    // network blip the atelier didn't press the button for.
    stubAnalytics({ data: analytics });
    renderPage();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await userEvent.click(screen.getByTestId("button-refresh"));

    const { predicate } = invalidate.mock.calls[0][0] as {
      predicate: (q: { queryKey: readonly unknown[] }) => boolean;
    };
    expect(predicate({ queryKey: ["studio-analytics"] })).toBe(true);
    expect(predicate({ queryKey: ["/api/studio/access"] })).toBe(false);
  });

  it("still offers sign-out when the staff check fails", async () => {
    gate.staff = false;
    gate.failed = true;
    stubAnalytics({});
    renderPage();

    await userEvent.click(screen.getByTestId("button-sign-out"));
    expect(h.signOut).toHaveBeenCalled();
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

  it("shows the commission capacity, with the count the public endpoint withholds", () => {
    renderPage();
    const panel = screen.getByTestId("panel-capacity");
    expect(panel).toHaveTextContent("Books open");
    expect(panel).toHaveTextContent("5 of 8 in production");
  });

  it("says the books are closed and why", () => {
    stubAnalytics({
      data: {
        ...analytics,
        capacity: {
          open: false,
          reason: "forced-closed" as const,
          limit: 8,
          inProduction: 2,
        },
      },
    });
    renderPage();
    const panel = screen.getByTestId("panel-capacity");
    expect(panel).toHaveTextContent("Books closed");
    // "Closed" alone can't tell the atelier whether they hit their own limit
    // or left the switch on `closed` last season.
    expect(panel).toHaveTextContent("Closed by hand");
  });

  it("says the count wasn't read rather than rendering it as zero", () => {
    stubAnalytics({
      data: {
        ...analytics,
        capacity: { open: true, reason: "unknown" as const, limit: 8 },
      },
    });
    renderPage();
    expect(screen.getByTestId("panel-capacity")).toHaveTextContent(
      "not counted",
    );
  });

  it("shows the three revenue series separately, never summed", () => {
    renderPage();
    const panel = screen.getByTestId("panel-revenue");
    expect(panel).toHaveTextContent("Shop taken $360");
    expect(panel).toHaveTextContent("Custom collected $750");
    expect(panel).toHaveTextContent("Custom booked $2,400");
  });

  it("says nothing about the ledger when its records cover the window", () => {
    renderPage();
    expect(screen.queryByTestId("revenue-ledger-note")).toBeNull();
  });

  it("HIDES the collected bar when there is no ledger, rather than zeroing it", () => {
    // A nought bar reads as "nothing came in"; the truth is "we have no
    // record", and keeping those apart is the panel's whole job here.
    stubAnalytics({
      data: { ...analytics, paymentLedger: { configured: false, payments: 0 } },
    });
    renderPage();

    const panel = screen.getByTestId("panel-revenue");
    expect(panel).not.toHaveTextContent("Custom collected");
    expect(screen.queryAllByTestId("revenue-collected-bar")).toHaveLength(0);
    expect(screen.getByTestId("revenue-ledger-note")).toHaveTextContent(
      "POSTGRES_URL",
    );
  });

  it("says so when the ledger couldn't be read, and still shows the rest", () => {
    stubAnalytics({
      data: {
        ...analytics,
        paymentLedger: { configured: true, unavailable: true, payments: 0 },
      },
    });
    renderPage();

    expect(screen.getByTestId("revenue-ledger-note")).toHaveTextContent(
      /couldn't be read/,
    );
    expect(screen.getByTestId("panel-revenue")).toHaveTextContent(
      "Shop taken $360",
    );
  });

  it("points at the backfill when the ledger is empty", () => {
    stubAnalytics({
      data: { ...analytics, paymentLedger: { configured: true, payments: 0 } },
    });
    renderPage();

    expect(screen.getByTestId("revenue-ledger-note")).toHaveTextContent(
      /backfill/,
    );
  });

  it("names the month the records start, when earlier months hold none", () => {
    // The one case where a real nought and a missing record look identical.
    stubAnalytics({
      data: {
        ...analytics,
        paymentLedger: {
          configured: true,
          payments: 2,
          recordedFrom: "2026-08",
        },
      },
    });
    renderPage();

    expect(screen.getByTestId("revenue-ledger-note")).toHaveTextContent(
      "recorded from August",
    );
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

  it("says how many orders the best-seller list can't see", () => {
    // An empty-ish list is ambiguous between "nothing sells" and "nothing is
    // linked", and for a shop that files Etsy receipts by hand it's the second.
    stubAnalytics({
      data: { ...analytics, topItemCoverage: { counted: 4, unlinked: 3 } },
    });
    renderPage();
    expect(screen.getByTestId("panel-top-items")).toHaveTextContent(
      /3 of the last 12 months' 7 orders aren't counted above/,
    );
  });

  it("keeps the coverage note off when every order is linked", () => {
    renderPage();
    expect(screen.getByTestId("panel-top-items")).not.toHaveTextContent(
      /aren't counted above/,
    );
  });

  it("breaks the orders down by sales channel, noughts included", () => {
    renderPage();
    const panel = screen.getByTestId("panel-channels");
    expect(panel).toHaveTextContent("Etsy");
    expect(panel).toHaveTextContent("$210");
    // A channel that went quiet stays on the panel as a nought, rather than
    // disappearing where nobody notices it has stopped.
    expect(panel).toHaveTextContent("Skate Shop");
    expect(panel).toHaveTextContent("$360 across 7 orders");
  });

  it("labels untagged orders as a gap, not as a channel", () => {
    stubAnalytics({
      data: {
        ...analytics,
        channels: [
          ...analytics.channels,
          { channel: "", orders: 2, revenue: 40 },
        ],
      },
    });
    renderPage();
    const panel = screen.getByTestId("panel-channels");
    expect(panel).toHaveTextContent("No channel set");
  });

  it("shows what is out at the skate shop and what it paid", () => {
    renderPage();
    const panel = screen.getByTestId("panel-consignment");
    expect(panel).toHaveTextContent("7 units on the shelf");
    expect(panel).toHaveTextContent("$245 at shelf price");
    expect(panel).toHaveTextContent("$52.50 paid out");
    expect(panel).toHaveTextContent("Bow Soaker");
  });

  it("says the consignment shelf isn't connected rather than showing it empty", () => {
    // An empty shelf and an unwired one look identical, and only one of them
    // means "nothing is out on consignment".
    stubAnalytics({
      data: {
        ...analytics,
        consignment: { ...analytics.consignment, configured: false },
      },
    });
    renderPage();
    expect(screen.getByTestId("panel-consignment")).toHaveTextContent(
      /isn't connected/,
    );
  });

  it("says so when the consignment database can't be seen", () => {
    stubAnalytics({
      data: {
        ...analytics,
        consignment: { ...analytics.consignment, unreachable: true },
      },
    });
    renderPage();
    expect(screen.getByTestId("panel-consignment")).toHaveTextContent(
      /Notion can't see it/,
    );
  });

  it("names settled placements whose payout figure is missing", () => {
    stubAnalytics({
      data: {
        ...analytics,
        consignment: {
          ...analytics.consignment,
          payoutUnknownPlacements: 2,
        },
      },
    });
    renderPage();
    expect(screen.getByTestId("panel-consignment")).toHaveTextContent(
      /2 settled placements sold something but carry no payout figure/,
    );
  });

  it("refreshes whatever section is on screen", async () => {
    // Refresh invalidates the ACTIVE queries rather than naming one, which with
    // a single section mounted is exactly what is being looked at — and is why
    // adding a panel costs the button nothing.
    renderPage();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await userEvent.click(screen.getByTestId("button-refresh"));

    expect(invalidate).toHaveBeenCalled();
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

/**
 * The dashboard is a set of sections with their own addresses, and only the
 * open one is mounted. That is the layout AND the load: mounting is what starts
 * a query, so a section nobody opened costs nothing. These assert the two halves
 * that make it true — the right panels for the address, and nothing else.
 */
describe("studio dashboard — sections", () => {
  beforeEach(() => stubAnalytics({ data: analytics }));

  it("offers every section in the registry, marking the open one", () => {
    renderPage();

    for (const section of STUDIO_SECTIONS) {
      expect(
        screen.getByTestId(`studio-section-${section.id}`),
      ).toBeInTheDocument();
    }
    expect(screen.getByTestId("studio-section-figures")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByTestId("studio-section-bookings")).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("links each section to its own address, so a reload lands back here", () => {
    renderPage();

    // The default section is `/studio` itself — one canonical URL per section.
    expect(screen.getByTestId("studio-section-figures")).toHaveAttribute(
      "href",
      "/studio",
    );
    expect(screen.getByTestId("studio-section-settings")).toHaveAttribute(
      "href",
      "/studio/settings",
    );
  });

  it("shows the figures at /studio, and no other section's panels", () => {
    renderPage();

    expect(screen.getByTestId("studio-view-figures")).toBeInTheDocument();
    expect(screen.getByTestId("stat-active")).toBeInTheDocument();
    // The panels that used to sit below the figures on one long page.
    expect(screen.queryByTestId("panel-availability")).not.toBeInTheDocument();
    expect(screen.queryByTestId("panel-settings")).not.toBeInTheDocument();
    expect(screen.queryByTestId("panel-requests")).not.toBeInTheDocument();
  });

  it("shows a section's own panels at its address, and not the figures", () => {
    loc.path = "/studio/bookings";
    renderPage();

    expect(screen.getByTestId("studio-view-bookings")).toBeInTheDocument();
    expect(screen.getByTestId("panel-availability")).toBeInTheDocument();
    expect(screen.getByTestId("panel-appointment-staff")).toBeInTheDocument();
    // The figures are the heaviest read on the dashboard; a section that isn't
    // them must not pay for them.
    expect(screen.queryByTestId("stat-active")).not.toBeInTheDocument();
  });

  it("keeps the request queue and the tools together — the hand-off needs both mounted", () => {
    loc.path = "/studio/requests";
    renderPage();

    expect(screen.getByTestId("panel-requests")).toBeInTheDocument();
    expect(screen.getByTestId("panel-tools")).toBeInTheDocument();
  });

  it("falls back to the figures for a section that doesn't exist", () => {
    // Not a 404: this page's 404 means "you are not staff", and a mistyped
    // section is a different thing to say.
    loc.path = "/studio/nonsense";
    renderPage();

    expect(screen.getByTestId("studio-view-figures")).toBeInTheDocument();
    expect(screen.queryByTestId("link-home")).not.toBeInTheDocument();
  });

  it("carries the section nav in every section, so there's always a way across", () => {
    loc.path = "/studio/guides";
    renderPage();

    expect(screen.getByTestId("studio-sections")).toBeInTheDocument();
    expect(screen.getByTestId("button-sign-out")).toBeInTheDocument();
  });
});
