import { Link, Redirect, useLocation } from "wouter";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import {
  useGetStudioAnalytics,
  getGetStudioAnalyticsQueryKey,
  getGetStudioAccessQueryKey,
  type StudioAnalytics,
  type StudioPipeline,
  type StudioProductionLoad,
  type StudioRevenueMonth,
  type StudioPaymentTotals,
  type StudioTopItem,
  type StudioTopItemCoverage,
  type StudioChannelSales,
  type StudioConsignment,
  type StudioCapacity,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import NotFound from "@/pages/not-found";
import { StudioTools } from "@/components/studio-tools";
import { StudioRequests } from "@/components/studio-requests";
import { StudioNewsletter } from "@/components/studio-newsletter";
import { StudioAvailability } from "@/components/studio-availability";
import { StudioAppointmentStaff } from "@/components/studio-appointment-staff";
import { StudioReviews } from "@/components/studio-reviews";
import { StudioMaterials } from "@/components/studio-materials";
import { StudioProductionPay } from "@/components/studio-production-pay";
import { StudioGuides, GuidesFor } from "@/components/studio-guides";
import { StudioSettings } from "@/components/studio-settings";
import { Seo } from "@/components/seo";
import { useAuth } from "@/lib/auth-context";
import { useStudioAccess } from "@/lib/studio-access";
import { supabase } from "@/lib/supabase";
import { setPostSignInPath } from "@/lib/post-signin";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { serverErrorMessage } from "@/lib/api-error";
import { toolHandoff, type ToolHandoff } from "@/lib/studio-handoff";
import {
  STUDIO_SECTIONS,
  resolveStudioSection,
  studioSectionPath,
  type StudioSectionId,
} from "@/lib/studio-sections";
import { formatPrice, formatDate } from "@/lib/format";
import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  LogOut,
  RefreshCw,
  Lock,
  Package,
  ShoppingBag,
  Hammer,
  TrendingUp,
  Wallet,
  Star,
  AlertTriangle,
  Zap,
  CalendarClock,
  Store,
  Split,
} from "lucide-react";

/**
 * The internal studio dashboard — the atelier's own working surface, so a
 * question like "what's overdue?" or "who asked for a refund?" doesn't mean
 * opening five Notion databases.
 *
 * Access is the same Supabase Auth session customers use, plus a server-side
 * staff gate — the allowlist, and (by default) a requirement that the session
 * was established with Google. Signed out redirects to sign-in; a 403 shows the
 * server's own reason with a Google re-sign-in to hand, which is the fix when a
 * staff member arrived with a password session. The gate that matters is the
 * server's — this page just renders what it's given.
 *
 * The gate is `GET /studio/access` (via `useStudioAccess`) rather than the
 * figures, and that choice is what lets the page be split into sections at all.
 * The access probe reads nothing — reaching the handler IS the answer — and the
 * navbar has already asked it and cached it for the session, so gating on it
 * costs no request. Gating on the analytics instead, as this page used to,
 * would have meant every section paying for three bounded full-database scans
 * just to find out whether it was allowed to render.
 *
 * The panels are grouped into sections with their own addresses
 * (`lib/studio-sections.ts`), and only the open section is mounted. That is a
 * layout decision and a load decision at once: mounting is what starts a query,
 * so a view fetches what it shows and nothing else, where the single-scroll
 * version fired nine staff-gated Notion reads before anything was on screen.
 *
 * It is titled "Dashboard" and *is* the signed-in destination for staff:
 * `/account` hands them here rather than showing a customer portal they'd
 * never have anything in. That's why sign-out lives in this header too — with
 * the account portal out of reach, there'd otherwise be no way out.
 *
 * The charts are deliberately plain CSS bars. A charting library would be the
 * largest dependency in the app for six panels of numbers, and the repo keeps
 * its dependencies pruned on purpose.
 */
export default function Studio() {
  const [location, navigate] = useLocation();
  const { session, user, loading, signOut } = useAuth();
  const access = useStudioAccess();
  const section = resolveStudioSection(location);

  const handleSignOut = async () => {
    await signOut();
    navigate("/account/login");
  };

  // Signed out (or the session expired) → sign in, same as the account portal.
  if ((!loading && !session) || access.status === 401) {
    return <Redirect to="/account/login" replace />;
  }

  return (
    <PageShell align="top" className="pt-24 sm:pt-28 pb-16 sm:pb-20">
      <Seo {...ROUTE_SEO["/studio"]} />
      <div className="w-full max-w-4xl z-10 mx-auto px-4 sm:px-6 animate-in fade-in duration-700">
        {access.loading ? (
          <div
            className="flex items-center justify-center py-24"
            data-testid="studio-loading"
          >
            <Loader2
              className="w-6 h-6 animate-spin text-primary"
              strokeWidth={1}
            />
          </div>
        ) : access.staff ? (
          // Confirmed staff comes FIRST, so a later probe that hiccups can't
          // evict someone the server has already vouched for: the answer is
          // cached for the session, and a failed refetch leaves it in place.
          <StudioDashboard
            section={section}
            email={user?.email}
            onSignOut={handleSignOut}
          />
        ) : access.refused ? (
          <AccessDenied reason={access.reason} />
        ) : access.failed ? (
          // The probe didn't answer — an outage, not a refusal. Saying so is
          // the point: rendering Not Found here would tell a staff member they
          // aren't staff, which is both untrue and unactionable.
          <div className="text-center py-16" data-testid="studio-unavailable">
            <h1 className="text-2xl sm:text-3xl font-serif mb-4">
              Something went wrong
            </h1>
            <p className="text-muted-foreground">
              We couldn&apos;t check your studio access just now. Please try
              again in a moment.
            </p>
            {/* Sign-out lives on the dashboard, and `/account` sends staff back
                here — so without it in this branch too, a failed check is a
                dead end with no way off the page. */}
            <div className="mt-8 flex justify-center">
              <SignOutButton onSignOut={handleSignOut} />
            </div>
          </div>
        ) : (
          // Not a studio account → render exactly what a mistyped URL renders.
          // The server answers 404 rather than 403 for this precisely so the
          // page can (see `requireStaff`): the dashboard is unlinked and
          // noindexed, and telling a customer who typed `/studio` that access
          // was *refused* would confirm there is something here to find.
          // Returning the real page, not a copy of it, is what keeps the two
          // indistinguishable.
          <NotFound />
        )}
      </div>
    </PageShell>
  );
}

/** The dashboard proper: the header that every section shares, the section
 * switcher, and the one section that is open. */
function StudioDashboard({
  section,
  email,
  onSignOut,
}: {
  section: StudioSectionId;
  email?: string;
  onSignOut: () => Promise<void>;
}) {
  return (
    <>
      <header className="flex flex-col gap-3 mb-6 sm:mb-8 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif text-foreground mb-2">
            Dashboard
          </h1>
          {email && (
            <p
              className="text-xs text-muted-foreground/80 font-light break-all"
              data-testid="studio-email"
            >
              Signed in as {email}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 -ml-3 sm:ml-0">
          <RefreshButton />
          <SignOutButton onSignOut={onSignOut} />
        </div>
      </header>

      <SectionNav active={section} />
      <SectionView section={section} />
    </>
  );
}

/**
 * The section switcher.
 *
 * Real links, not tab state: a section is an address, so a reload, a bookmark
 * and the back button all land where the atelier left off. They're rendered
 * from `STUDIO_SECTIONS` rather than written out, so adding a section adds a
 * chip here for free — the whole point of the registry.
 */
function SectionNav({ active }: { active: StudioSectionId }) {
  return (
    <nav
      aria-label="Dashboard sections"
      className="mb-8 sm:mb-10 flex flex-wrap gap-2 border-b border-border pb-4"
      data-testid="studio-sections"
    >
      {STUDIO_SECTIONS.map((section) => {
        const on = section.id === active;
        return (
          <Link
            key={section.id}
            href={studioSectionPath(section.id)}
            title={section.summary}
            aria-current={on ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-xs tracking-wide transition-colors ${
              on
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`studio-section-${section.id}`}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Refresh what's on screen.
 *
 * `invalidateQueries` with no filter refetches the ACTIVE queries, which with
 * one section mounted is exactly the section being looked at. That's why it
 * replaced a direct `analytics.refetch()`: the button used to know the one
 * query the page had, and would otherwise have needed to learn every panel's.
 * Adding a panel now costs this component nothing.
 */
function RefreshButton() {
  const queryClient = useQueryClient();
  const fetching = useIsFetching() > 0;

  // Everything active EXCEPT the staff probe. Refresh means the data, not the
  // door: re-asking the gate would put the whole dashboard behind a network
  // blip that has nothing to do with what the atelier pressed the button for.
  const [accessKey] = getGetStudioAccessQueryKey();
  const refresh = () =>
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] !== accessKey,
    });

  return (
    <Button
      variant="ghost"
      onClick={() => void refresh()}
      disabled={fetching}
      className="text-muted-foreground hover:text-primary gap-2 text-xs tracking-widest uppercase"
      data-testid="button-refresh"
    >
      <RefreshCw
        className={`w-4 h-4 ${fetching ? "animate-spin" : ""}`}
        strokeWidth={1.5}
      />
      Refresh
    </Button>
  );
}

/**
 * One section's panels.
 *
 * Typed `Record<StudioSectionId, …>`, so a section added to the registry
 * without a view here fails to compile rather than rendering a blank page.
 *
 * Each entry carries the panels AND the guides filed against them, so a
 * procedure sits with the thing it describes rather than in a manual elsewhere
 * on the page. `GuidesFor` renders nothing when there are none.
 */
const SECTION_VIEWS: Record<StudioSectionId, () => React.ReactElement> = {
  figures: FiguresSection,
  requests: RequestsSection,
  reviews: ReviewsSection,
  bookings: BookingsSection,
  materials: MaterialsSection,
  pay: PaySection,
  settings: SettingsSection,
  guides: GuidesSection,
};

function SectionView({ section }: { section: StudioSectionId }) {
  const View = SECTION_VIEWS[section];
  return (
    <div
      className="space-y-10 sm:space-y-12"
      data-testid={`studio-view-${section}`}
    >
      <View />
    </div>
  );
}

/** The numbers. The only section with a heavy read behind it — three bounded
 * full-database scans — which is why it no longer runs on every view. */
function FiguresSection() {
  const analytics = useGetStudioAnalytics({
    query: { queryKey: getGetStudioAnalyticsQueryKey(), retry: false },
  });

  if (analytics.isLoading) {
    return (
      <div
        className="flex items-center justify-center py-16"
        data-testid="figures-loading"
      >
        <Loader2
          className="w-6 h-6 animate-spin text-primary"
          strokeWidth={1}
        />
      </div>
    );
  }

  // A failed read costs this section, not the dashboard. The request queue and
  // the tools are still reachable during a Notion wobble, which is when the
  // atelier is most likely to need them.
  if (analytics.isError || !analytics.data) {
    return (
      <div className="text-center py-16" data-testid="studio-error">
        <h2 className="text-xl sm:text-2xl font-serif mb-3">
          Something went wrong
        </h2>
        <p className="text-muted-foreground">
          {serverErrorMessage(analytics.error) ??
            "We couldn't load the studio figures just now. Please try again in a moment."}
        </p>
      </div>
    );
  }

  return <Figures data={analytics.data} />;
}

function Figures({ data }: { data: StudioAnalytics }) {
  const thisMonth = data.revenue[data.revenue.length - 1];

  return (
    <>
      <p
        className="-mt-2 text-xs text-muted-foreground font-light"
        data-testid="figures-generated"
      >
        Figures as of {formatDateTime(data.generatedAt)}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        <StatTile
          label="Active orders"
          value={String(data.production.activeOrders)}
          hint={`${data.production.unscheduled} without a due date`}
          testId="stat-active"
        />
        <StatTile
          label="Overdue"
          value={String(data.production.overdue)}
          hint={`${data.production.dueThisWeek} due in 7 days`}
          emphasis={data.production.overdue > 0}
          testId="stat-overdue"
        />
        <StatTile
          label="Still to collect"
          value={formatPrice(data.payments.outstandingTotal)}
          hint={`across ${data.payments.unpaidInvoiceCount} invoice${
            data.payments.unpaidInvoiceCount === 1 ? "" : "s"
          }`}
          testId="stat-outstanding"
        />
        <StatTile
          label="Shop this month"
          value={formatPrice(thisMonth?.shopRevenue ?? 0)}
          hint={`${thisMonth?.shopOrders ?? 0} order${
            thisMonth?.shopOrders === 1 ? "" : "s"
          }`}
          testId="stat-shop-month"
        />
      </div>

      <CapacityPanel capacity={data.capacity} />

      <ProductionPanel production={data.production} />

      <PipelinePanel
        icon={<Package className="w-4 h-4" strokeWidth={1.5} />}
        title="Custom orders by stage"
        pipeline={data.customOrders}
        testId="pipeline-custom"
      />

      <PipelinePanel
        icon={<ShoppingBag className="w-4 h-4" strokeWidth={1.5} />}
        title="Shop orders by status"
        pipeline={data.shopOrders}
        testId="pipeline-shop"
      />

      <RevenuePanel months={data.revenue} />

      <ChannelsPanel channels={data.channels} />

      <ConsignmentPanel consignment={data.consignment} />

      <PaymentsPanel payments={data.payments} />

      <TopItemsPanel items={data.topItems} coverage={data.topItemCoverage} />

      <GuidesFor section="figures" />
    </>
  );
}

/**
 * The day's work: the request queue, the newsletter sign-ups, and the tools.
 *
 * These three are one section because the queue hands a request's own order
 * number to the tool that actions it — see `lib/studio-handoff.ts`. The state
 * lives here because the two are sibling panels, and the tools panel is where
 * the confirmation stays: the queue prepares a run, it never starts one. Split
 * across sections, the hand-off would be filling a form that isn't mounted.
 */
function RequestsSection() {
  const [handoff, setHandoff] = useState<ToolHandoff | undefined>();

  return (
    <>
      <StudioRequests onHandoff={(next) => setHandoff(toolHandoff(next))} />
      <GuidesFor section="requests" />

      <StudioNewsletter />
      <GuidesFor section="newsletter" />

      <StudioTools handoff={handoff} />
    </>
  );
}

function ReviewsSection() {
  return (
    <>
      <StudioReviews />
      <GuidesFor section="reviews" />
    </>
  );
}

/** When each person works, and what they work on. Two halves of one answer:
 * a customer is offered a time only where both agree. */
function BookingsSection() {
  return (
    <>
      <StudioAvailability />
      <GuidesFor section="availability" />

      <StudioAppointmentStaff />
      <GuidesFor section="appointment-staff" />
    </>
  );
}

function MaterialsSection() {
  return (
    <>
      <StudioMaterials />
      <GuidesFor section="materials" />
    </>
  );
}

/** What the studio owes its own people. Its own section, and its own read,
 * because folding it into the figures would make everyone opening the figures
 * pay for two more full-database scans to answer a payroll question. */
function PaySection() {
  return (
    <>
      <StudioProductionPay />
      <GuidesFor section="pay" />
    </>
  );
}

function SettingsSection() {
  return (
    <>
      <StudioSettings />
      <GuidesFor section="settings" />
    </>
  );
}

function GuidesSection() {
  return <StudioGuides />;
}

/** The way off the dashboard. Staff have no account portal to sign out from —
 * `/account` hands them back here — so every state this page can be in has to
 * carry one. */
function SignOutButton({ onSignOut }: { onSignOut: () => Promise<void> }) {
  return (
    <Button
      variant="ghost"
      onClick={() => void onSignOut()}
      className="text-muted-foreground hover:text-primary gap-2 text-xs tracking-widest uppercase"
      data-testid="button-sign-out"
    >
      <LogOut className="w-4 h-4" strokeWidth={1.5} />
      Sign out
    </Button>
  );
}

/**
 * A studio account whose session wasn't established with Google — since the
 * allowlist failure now answers 404, this is the only thing that lands here.
 * That makes the Google button the actual fix rather than a shot in the dark,
 * and it means only someone already holding a staff mailbox can see this panel
 * at all. The server's own message is still shown verbatim rather than guessed
 * at, so a future refusal reason needs no change here.
 */
function AccessDenied({ reason }: { reason?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInWithGoogle = async () => {
    if (!supabase) return;
    setError(null);
    setBusy(true);
    // Come back here rather than the customer dashboard once Google is done.
    setPostSignInPath("/studio");
    // A stale session has to go first, or Supabase returns the existing one and
    // its sign-in method (the thing being refused) never changes.
    await supabase.auth.signOut();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/account/callback` },
    });
    // On success the browser is redirected away; only reached on error.
    if (oauthError) {
      setBusy(false);
      setError(oauthError.message);
    }
  };

  return (
    <div className="text-center py-16" data-testid="studio-forbidden">
      <Lock
        className="w-6 h-6 mx-auto mb-4 text-muted-foreground"
        strokeWidth={1}
      />
      <h1 className="text-2xl sm:text-3xl font-serif mb-4">
        Dashboard access only
      </h1>
      <p className="text-muted-foreground max-w-md mx-auto">
        {reason ??
          "Studio access requires signing in with Google. Please sign out and use Continue with Google."}
      </p>
      {supabase && (
        <Button
          variant="outline"
          onClick={() => void signInWithGoogle()}
          disabled={busy}
          className="mt-8 gap-2"
          data-testid="button-studio-google"
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
          ) : null}
          Continue with Google
        </Button>
      )}
      {error && (
        <p
          className="mt-4 text-sm text-destructive"
          data-testid="studio-forbidden-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}

// --- Chrome ---

function Section({
  icon,
  title,
  children,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId}>
      <h2 className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
        {icon}
        {title}
      </h2>
      <div className="rounded-sm border border-border bg-card/40 p-4 sm:p-5">
        {children}
      </div>
    </section>
  );
}

function StatTile({
  label,
  value,
  hint,
  emphasis,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
  testId?: string;
}) {
  return (
    <div
      className="rounded-sm border border-border bg-card/40 p-3 sm:p-4"
      data-testid={testId}
    >
      <p className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground mb-2">
        {label}
      </p>
      <p
        className={`text-xl sm:text-2xl font-serif ${
          emphasis ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-xs text-muted-foreground font-light">{hint}</p>
      )}
    </div>
  );
}

/**
 * A labelled horizontal bar, sized against the largest value in its group.
 *
 * Three fixed columns (label, bar, figure) leave the bar about 40px wide on a
 * phone — and the bar is the whole point of the row. So below `sm` the bar
 * wraps onto its own full-width line beneath the label and figure. `order-*`
 * does the rearranging rather than a second copy of the figure, so the text
 * appears once however the row is laid out.
 */
function BarRow({
  label,
  value,
  max,
  display,
}: {
  label: string;
  value: number;
  max: number;
  display?: string;
}) {
  const width = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
      <span className="order-1 min-w-0 flex-1 truncate text-muted-foreground font-light sm:w-36 sm:flex-none sm:shrink-0 lg:w-56">
        {label}
      </span>
      <span className="order-3 w-full h-2 rounded-full bg-muted/60 overflow-hidden sm:order-2 sm:w-auto sm:flex-1">
        <span
          className="block h-full bg-primary/70"
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="order-2 shrink-0 tabular-nums sm:order-3 sm:w-20 sm:text-right">
        {display ?? value}
      </span>
    </div>
  );
}

// --- Panels ---

/** A panel's own summary figures, above its detail. */
function PanelSummary({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 text-xs text-muted-foreground font-light">{children}</p>
  );
}

/**
 * Whether the books are open for bespoke commissions, and the count behind it.
 *
 * These numbers are deliberately absent from the public `GET /capacity` — how
 * much work the studio is holding is the studio's own business — so this panel
 * is the only place they are readable. It reports the *reason*, not just the
 * state, because "closed" alone can't tell the atelier whether they hit their
 * own limit or left the switch on `closed` last season.
 */
function CapacityPanel({ capacity }: { capacity: StudioCapacity }) {
  const { open, reason, limit, inProduction } = capacity;

  const explanation: Record<StudioCapacity["reason"], string> = {
    unlimited:
      "No limit is set, so the books never close on the count. Set “Commissions in production at once” under Studio settings to turn this on.",
    "under-capacity": "Under the limit, so new commissions can be ordered.",
    "at-capacity":
      "The limit is reached, so the order form is offering the waitlist instead of a commission.",
    "forced-open":
      "Held open by hand — the count is being ignored. Set “Commission intake” back to auto to let the limit decide again.",
    "forced-closed":
      "Closed by hand, whatever the count says. Set “Commission intake” back to auto or open to start taking commissions again.",
    unknown:
      "The order count couldn't be read, so the books stayed open rather than closing on a bad read.",
  };

  return (
    <Section
      icon={<CalendarClock className="w-4 h-4" strokeWidth={1.5} />}
      title="Commission capacity"
      testId="panel-capacity"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
        <span
          className={`text-sm tracking-wide ${open ? "text-foreground" : "text-primary"}`}
          data-testid="capacity-state"
        >
          {open ? "Books open" : "Books closed"}
        </span>
        <span className="text-sm text-muted-foreground font-light tabular-nums">
          {/* An absent count is NOT zero — it means the read failed — so it is
              said in words rather than rendered as a nought. */}
          {inProduction === undefined
            ? "commissions in production: not counted"
            : limit > 0
              ? `${inProduction} of ${limit} in production`
              : `${inProduction} in production`}
        </span>
      </div>
      <p
        className="text-xs text-muted-foreground font-light"
        data-testid="capacity-reason"
      >
        {explanation[reason]}
      </p>
    </Section>
  );
}

function ProductionPanel({ production }: { production: StudioProductionLoad }) {
  return (
    <Section
      icon={<Hammer className="w-4 h-4" strokeWidth={1.5} />}
      title="Production load"
      testId="panel-production"
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 text-center">
        <Figure label="Scheduled" value={production.scheduled} />
        <Figure
          label="Due in 7 days"
          value={production.dueThisWeek}
          icon={<AlertTriangle className="w-3 h-3" strokeWidth={1.5} />}
        />
        <Figure label="Due in 30 days" value={production.dueThisMonth} />
        <Figure
          label="Rush"
          value={production.rush}
          icon={<Zap className="w-3 h-3" strokeWidth={1.5} />}
        />
      </div>

      {production.upcoming.length === 0 ? (
        <p className="text-sm text-muted-foreground font-light">
          Nothing scheduled — no active order carries a due date yet.
        </p>
      ) : (
        <ul className="divide-y divide-border/60" data-testid="upcoming-orders">
          {production.upcoming.map((order) => (
            <li
              key={order.orderNumber}
              className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
            >
              <span className="min-w-0">
                <span className="block truncate">
                  {order.orderName || order.orderNumber}
                </span>
                <span className="block text-xs text-muted-foreground font-light">
                  {order.stage || "No stage set"}
                  {order.rush ? " · Rush" : ""}
                </span>
              </span>
              <span
                className={`shrink-0 text-xs ${
                  order.overdue ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {order.overdue ? "Overdue · " : ""}
                {formatDate(order.dueDate)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Figure({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xl sm:text-2xl font-serif">{value}</p>
      <p className="mt-1 inline-flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase text-muted-foreground">
        {icon}
        {label}
      </p>
    </div>
  );
}

function PipelinePanel({
  icon,
  title,
  pipeline,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  pipeline: StudioPipeline;
  testId: string;
}) {
  const max = pipeline.stages.reduce((top, s) => Math.max(top, s.count), 0);
  return (
    <Section icon={icon} title={title} testId={testId}>
      <PanelSummary>
        {pipeline.total} on record · {pipeline.completed} finished ·{" "}
        {pipeline.cancelled} cancelled
      </PanelSummary>
      {pipeline.stages.length === 0 ? (
        <p className="text-sm text-muted-foreground font-light">
          No stages configured in Notion.
        </p>
      ) : (
        <div className="space-y-2">
          {pipeline.stages.map((stage) => (
            <BarRow
              key={stage.stage}
              label={stage.stage}
              value={stage.count}
              max={max}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

/** Twelve months of trade. The two series are shown side by side and never
 * summed — shop revenue is money collected, the custom figure is work booked
 * (see the API's own note; Notion holds no per-payment dates). */
function RevenuePanel({ months }: { months: StudioRevenueMonth[] }) {
  const max = months.reduce(
    (top, m) => Math.max(top, m.shopRevenue, m.customBooked),
    0,
  );
  const shopTotal = months.reduce((sum, m) => sum + m.shopRevenue, 0);
  const customTotal = months.reduce((sum, m) => sum + m.customBooked, 0);

  // When the chart scrolls (phone widths), open it on the most recent month
  // rather than a year ago — "how is this month going" is the question being
  // asked. A no-op at desktop widths, where nothing overflows.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [months]);

  return (
    <Section
      icon={<TrendingUp className="w-4 h-4" strokeWidth={1.5} />}
      title="Money by month"
      testId="panel-revenue"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-primary/70" />
          Shop taken {formatPrice(shopTotal)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-primary/30" />
          Custom booked {formatPrice(customTotal)}
        </span>
      </div>

      {/* Twelve months of paired bars can't fit a phone at a readable width,
          so the chart scrolls sideways below `sm` (fixed-width columns) and
          fills the panel from `sm` up (flexible ones). The negative margin
          lets it scroll edge to edge inside the card's padding. */}
      <div
        ref={scroller}
        className="-mx-4 px-4 overflow-x-auto sm:mx-0 sm:px-0 sm:overflow-visible"
      >
        <div
          className="flex items-end gap-1.5 h-40"
          data-testid="revenue-chart"
        >
          {months.map((month) => (
            <div
              key={month.month}
              className="w-9 shrink-0 flex flex-col items-center gap-1 h-full justify-end sm:w-auto sm:flex-1"
              title={`${monthLabel(month.month)} — shop ${formatPrice(
                month.shopRevenue,
              )}, custom booked ${formatPrice(month.customBooked)}`}
            >
              <span className="flex items-end gap-0.5 w-full h-full">
                <span
                  className="flex-1 bg-primary/70 rounded-t-sm min-h-px self-end"
                  style={{ height: `${barHeight(month.shopRevenue, max)}%` }}
                />
                <span
                  className="flex-1 bg-primary/30 rounded-t-sm min-h-px self-end"
                  style={{ height: `${barHeight(month.customBooked, max)}%` }}
                />
              </span>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {monthLabel(month.month).slice(0, 3)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

/**
 * Where the money came from — the studio's sales channels side by side.
 *
 * The atelier has always filed Etsy receipts, skate-shop sales and word-of-mouth
 * orders into the same database the website writes to, so until the orders
 * carried a channel every one of those looked like a website sale. Channels with
 * no trade this year are still listed, as noughts: "nothing from Etsy since
 * spring" is a figure worth being able to read, and a channel that quietly
 * vanished from a panel is one nobody notices has gone quiet.
 *
 * The untagged row is the one that is NOT a channel. It is a gap in the records
 * — orders somebody filed and didn't tag — so it is labelled as one rather than
 * credited to a channel it might not belong to.
 */
function ChannelsPanel({ channels }: { channels: StudioChannelSales[] }) {
  const max = channels.reduce((top, c) => Math.max(top, c.revenue), 0);
  const total = channels.reduce((sum, c) => sum + c.revenue, 0);
  const orders = channels.reduce((sum, c) => sum + c.orders, 0);

  return (
    <Section
      icon={<Split className="w-4 h-4" strokeWidth={1.5} />}
      title="Where the orders came from"
      testId="panel-channels"
    >
      {channels.length === 0 ? (
        <p className="text-sm text-muted-foreground font-light">
          No sales channels are set up on the shop orders database yet, so
          there&apos;s nothing to break these figures down by.
        </p>
      ) : (
        <>
          <PanelSummary>
            {formatPrice(total)} across {orders} order
            {orders === 1 ? "" : "s"} in the last 12 months
          </PanelSummary>
          <div className="space-y-2">
            {channels.map((channel) => (
              <BarRow
                key={channel.channel || "unattributed"}
                label={
                  channel.channel === "" ? "No channel set" : channel.channel
                }
                value={channel.revenue}
                max={max}
                display={`${formatPrice(channel.revenue)} · ${channel.orders}`}
              />
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

/**
 * The pieces out at the skate shop, and what they have brought in.
 *
 * Reported apart from the order figures on purpose. A consignment sale is not an
 * order: nobody knows a piece sold until the shelf is counted at the next visit,
 * and what arrives is the studio's share of a shelf price rather than the price.
 * The two halves of the panel are two different kinds of fact — stock the studio
 * still owns, and money it has been paid — so they are never added together.
 */
function ConsignmentPanel({ consignment }: { consignment: StudioConsignment }) {
  const {
    configured,
    unreachable,
    openPlacements,
    atShopUnits,
    atShopRetail,
    settledUnits,
    settledPayout,
    payoutUnknownPlacements,
    items,
  } = consignment;
  const max = items.reduce(
    (top, item) => Math.max(top, item.atShop, item.sold),
    0,
  );

  return (
    <Section
      icon={<Store className="w-4 h-4" strokeWidth={1.5} />}
      title="Out on consignment"
      testId="panel-consignment"
    >
      {!configured ? (
        <p className="text-sm text-muted-foreground font-light">
          The consignment database isn&apos;t connected, so stock held at the
          skate shop isn&apos;t counted here. Set{" "}
          <code className="text-xs">NOTION_CONSIGNMENT_DATABASE_ID</code> to
          track it.
        </p>
      ) : unreachable ? (
        <p className="text-sm text-muted-foreground font-light">
          The consignment database is configured but Notion can&apos;t see it.
          Check the id, and that the integration is shared with that database.
        </p>
      ) : (
        <>
          <PanelSummary>
            {atShopUnits} unit{atShopUnits === 1 ? "" : "s"} on the shelf across{" "}
            {openPlacements} open placement
            {openPlacements === 1 ? "" : "s"} ({formatPrice(atShopRetail)} at
            shelf price) · {formatPrice(settledPayout)} paid out on{" "}
            {settledUnits} unit{settledUnits === 1 ? "" : "s"} settled in the
            last 12 months
          </PanelSummary>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground font-light">
              Nothing is out at the shop and nothing has been settled in the
              last 12 months.
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <BarRow
                  key={item.name}
                  label={item.name}
                  value={item.atShop}
                  max={max}
                  display={`${item.atShop} out · ${item.sold} sold`}
                />
              ))}
            </div>
          )}
          {payoutUnknownPlacements > 0 && (
            <p className="mt-4 text-xs text-muted-foreground font-light">
              {payoutUnknownPlacements === 1
                ? "1 settled placement sold something but carries"
                : `${payoutUnknownPlacements} settled placements sold something but carry`}{" "}
              no payout figure, so that money isn&apos;t in the total above.
              Check the Your Payout formula on those rows.
            </p>
          )}
        </>
      )}
    </Section>
  );
}

function PaymentsPanel({ payments }: { payments: StudioPaymentTotals }) {
  const max = Math.max(
    payments.depositsCollected,
    payments.depositsOutstanding,
    payments.balancesCollected,
    payments.balancesOutstanding,
  );
  return (
    <Section
      icon={<Wallet className="w-4 h-4" strokeWidth={1.5} />}
      title="Deposits & balances"
      testId="panel-payments"
    >
      <PanelSummary>
        {formatPrice(payments.invoicedTotal)} invoiced across{" "}
        {payments.invoiceCount} invoice
        {payments.invoiceCount === 1 ? "" : "s"} ·{" "}
        {formatPrice(payments.collectedTotal)} collected
      </PanelSummary>
      <div className="space-y-2">
        <BarRow
          label="Deposits collected"
          value={payments.depositsCollected}
          max={max}
          display={formatPrice(payments.depositsCollected)}
        />
        <BarRow
          label="Deposits due"
          value={payments.depositsOutstanding}
          max={max}
          display={formatPrice(payments.depositsOutstanding)}
        />
        <BarRow
          label="Balances collected"
          value={payments.balancesCollected}
          max={max}
          display={formatPrice(payments.balancesCollected)}
        />
        <BarRow
          label="Balances due"
          value={payments.balancesOutstanding}
          max={max}
          display={formatPrice(payments.balancesOutstanding)}
        />
      </div>
    </Section>
  );
}

/**
 * The shop's best sellers, with what the list cannot see stated underneath.
 *
 * Item-level figures come from each order's inventory relation, and a hand-filed
 * Etsy receipt usually carries none — so a short list is ambiguous between
 * "nothing sells" and "nothing is linked", and the second is the more common
 * answer. Saying how many orders were left out is what makes the list readable
 * either way.
 */
function TopItemsPanel({
  items,
  coverage,
}: {
  items: StudioTopItem[];
  coverage: StudioTopItemCoverage;
}) {
  const max = items.reduce((top, item) => Math.max(top, item.orders), 0);
  return (
    <Section
      icon={<Star className="w-4 h-4" strokeWidth={1.5} />}
      title="Best sellers"
      testId="panel-top-items"
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground font-light">
          No item-level figures yet. An order counts here once its row links the
          inventory pieces that were bought — the website does that itself, and
          an order filed by hand needs its Inventory Items relation set.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <BarRow
              key={item.name}
              label={item.name}
              value={item.orders}
              max={max}
            />
          ))}
        </div>
      )}
      {coverage.unlinked > 0 && (
        <p className="mt-4 text-xs text-muted-foreground font-light">
          {coverage.unlinked} of the last 12 months&apos;{" "}
          {coverage.counted + coverage.unlinked} orders aren&apos;t counted
          above: their rows link no inventory piece. Set Inventory Items on them
          in Notion to bring them in.
        </p>
      )}
    </Section>
  );
}

// --- Formatting ---

/** A bar's height as a percentage of the panel's tallest value. Anything above
 * zero keeps at least a sliver so a small month is visible rather than absent. */
function barHeight(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(2, Math.round((value / max) * 100));
}

/** "2026-08" → "August". */
export function monthLabel(month: string): string {
  const [year, index] = month.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(index)) return month;
  return new Date(Date.UTC(year, index - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
}

/** The server's own explanation for a refusal, when it sent one. The API's
 * error envelope is `{ error }`, and the generated client hangs the parsed body
 * off the thrown error as `data`. */
/** The "figures as of" line — a date-time, so a stale cached read is visible. */
function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
