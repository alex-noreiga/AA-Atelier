import { Redirect, useLocation } from "wouter";
import {
  useGetStudioAnalytics,
  getGetStudioAnalyticsQueryKey,
  type StudioAnalytics,
  type StudioPipeline,
  type StudioProductionLoad,
  type StudioRevenueMonth,
  type StudioPaymentTotals,
  type StudioTopItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import NotFound from "@/pages/not-found";
import { StudioTools } from "@/components/studio-tools";
import { StudioAvailability } from "@/components/studio-availability";
import { StudioReviews } from "@/components/studio-reviews";
import { StudioMaterials } from "@/components/studio-materials";
import { Seo } from "@/components/seo";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { setPostSignInPath } from "@/lib/post-signin";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { serverErrorMessage } from "@/lib/api-error";
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
} from "lucide-react";

/**
 * The internal studio dashboard — the atelier's own numbers in one place, so a
 * question like "what's overdue?" or "what's still to collect?" doesn't mean
 * opening five Notion databases.
 *
 * Access is the same Supabase Auth session customers use, plus a server-side
 * staff gate — the allowlist, and (by default) a requirement that the session
 * was established with Google. Signed out redirects to sign-in; a 403 shows the
 * server's own reason with a Google re-sign-in to hand, which is the fix when a
 * staff member arrived with a password session. The gate that matters is the
 * server's — this page just renders what it's given.
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
  const [, navigate] = useLocation();
  const { session, user, loading, signOut } = useAuth();

  const analytics = useGetStudioAnalytics({
    query: {
      queryKey: getGetStudioAnalyticsQueryKey(),
      // Only fetch once we know there's a session; a 401/403 must not retry.
      enabled: !loading && Boolean(session),
      retry: false,
    },
  });

  const status = (analytics.error as { status?: number } | null)?.status;

  const handleSignOut = async () => {
    await signOut();
    navigate("/account/login");
  };

  // Signed out (or the session expired) → sign in, same as the account portal.
  if ((!loading && !session) || (analytics.isError && status === 401)) {
    return <Redirect to="/account/login" replace />;
  }

  // Not a studio account → render exactly what a mistyped URL renders. The
  // server answers 404 rather than 403 for this precisely so the page can (see
  // `requireStaff`): the dashboard is unlinked and noindexed, and telling a
  // customer who typed `/studio` that access was *refused* would confirm there
  // is something here to find. Returning the real page, not a copy of it, is
  // what keeps the two indistinguishable.
  if (analytics.isError && status === 404) {
    return <NotFound />;
  }

  return (
    <PageShell align="top" className="pt-24 sm:pt-28 pb-16 sm:pb-20">
      <Seo {...ROUTE_SEO["/studio"]} />
      <div className="w-full max-w-4xl z-10 mx-auto px-4 sm:px-6 animate-in fade-in duration-700">
        {loading || analytics.isLoading ? (
          <div
            className="flex items-center justify-center py-24"
            data-testid="studio-loading"
          >
            <Loader2
              className="w-6 h-6 animate-spin text-primary"
              strokeWidth={1}
            />
          </div>
        ) : status === 403 ? (
          <AccessDenied reason={serverErrorMessage(analytics.error)} />
        ) : analytics.isError || !analytics.data ? (
          <div className="text-center py-16" data-testid="studio-error">
            <h1 className="text-2xl sm:text-3xl font-serif mb-4">
              Something went wrong
            </h1>
            <p className="text-muted-foreground">
              We couldn&apos;t load the studio figures just now. Please try
              again in a moment.
            </p>
            {/* Sign-out lives on the dashboard, and `/account` sends staff back
                here — so without it in this branch too, a failed read is a dead
                end with no way off the page. */}
            <div className="mt-8 flex justify-center">
              <SignOutButton onSignOut={handleSignOut} />
            </div>
          </div>
        ) : (
          <>
            <header className="flex flex-col gap-3 mb-10 sm:mb-12 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif text-foreground mb-2">
                  Dashboard
                </h1>
                <p className="text-muted-foreground font-light text-sm">
                  Figures as of {formatDateTime(analytics.data.generatedAt)}
                </p>
                {user?.email && (
                  <p
                    className="mt-1 text-xs text-muted-foreground/80 font-light break-all"
                    data-testid="studio-email"
                  >
                    Signed in as {user.email}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0 -ml-3 sm:ml-0">
                <Button
                  variant="ghost"
                  onClick={() => void analytics.refetch()}
                  disabled={analytics.isFetching}
                  className="text-muted-foreground hover:text-primary gap-2 text-xs tracking-widest uppercase"
                  data-testid="button-refresh"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${analytics.isFetching ? "animate-spin" : ""}`}
                    strokeWidth={1.5}
                  />
                  Refresh
                </Button>
                <SignOutButton onSignOut={handleSignOut} />
              </div>
            </header>

            <Dashboard data={analytics.data} />
          </>
        )}
      </div>
    </PageShell>
  );
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

function Dashboard({ data }: { data: StudioAnalytics }) {
  const thisMonth = data.revenue[data.revenue.length - 1];

  return (
    <div className="space-y-10 sm:space-y-12">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        <StatTile
          label="In production"
          value={String(data.production.activeOrders)}
          hint={`${data.production.unscheduled} without a due date`}
          testId="stat-active"
        />
        <StatTile
          label="Overdue"
          value={String(data.production.overdue)}
          hint={`${data.production.dueThisWeek} due this week`}
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
          label="Shop, this month"
          value={formatPrice(thisMonth?.shopRevenue ?? 0)}
          hint={`${thisMonth?.shopOrders ?? 0} order${
            thisMonth?.shopOrders === 1 ? "" : "s"
          }`}
          testId="stat-shop-month"
        />
      </div>

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

      <PaymentsPanel payments={data.payments} />

      <TopItemsPanel items={data.topItems} />

      <StudioMaterials />

      <StudioReviews />

      <StudioAvailability />

      <StudioTools />
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
      title="By month"
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

function TopItemsPanel({ items }: { items: StudioTopItem[] }) {
  const max = items.reduce((top, item) => Math.max(top, item.orders), 0);
  return (
    <Section
      icon={<Star className="w-4 h-4" strokeWidth={1.5} />}
      title="Best sellers"
      testId="panel-top-items"
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground font-light">
          No item-level figures yet. Shop orders record which inventory pieces
          were bought once the inventory relation is switched on; orders placed
          before that aren&apos;t counted here.
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
