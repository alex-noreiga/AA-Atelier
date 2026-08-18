import { Redirect } from "wouter";
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
import { Seo } from "@/components/seo";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { setPostSignInPath } from "@/lib/post-signin";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { formatPrice, formatDate } from "@/lib/format";
import { useState } from "react";
import {
  Loader2,
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
 * The charts are deliberately plain CSS bars. A charting library would be the
 * largest dependency in the app for six panels of numbers, and the repo keeps
 * its dependencies pruned on purpose.
 */
export default function Studio() {
  const { session, loading } = useAuth();

  const analytics = useGetStudioAnalytics({
    query: {
      queryKey: getGetStudioAnalyticsQueryKey(),
      // Only fetch once we know there's a session; a 401/403 must not retry.
      enabled: !loading && Boolean(session),
      retry: false,
    },
  });

  const status = (analytics.error as { status?: number } | null)?.status;

  // Signed out (or the session expired) → sign in, same as the account portal.
  if ((!loading && !session) || (analytics.isError && status === 401)) {
    return <Redirect to="/account/login" replace />;
  }

  return (
    <PageShell align="top" className="pt-28 pb-20">
      <Seo {...ROUTE_SEO["/studio"]} />
      <div className="w-full max-w-4xl z-10 mx-auto px-6 animate-in fade-in duration-700">
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
          <AccessDenied reason={errorMessage(analytics.error)} />
        ) : analytics.isError || !analytics.data ? (
          <div className="text-center py-16" data-testid="studio-error">
            <h1 className="text-3xl font-serif mb-4">Something went wrong</h1>
            <p className="text-muted-foreground">
              We couldn&apos;t load the studio figures just now. Please try
              again in a moment.
            </p>
          </div>
        ) : (
          <>
            <header className="flex items-start justify-between gap-4 mb-12">
              <div>
                <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-2">
                  Studio
                </h1>
                <p className="text-muted-foreground font-light text-sm">
                  Figures as of {formatDateTime(analytics.data.generatedAt)}
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={() => void analytics.refetch()}
                disabled={analytics.isFetching}
                className="text-muted-foreground hover:text-primary shrink-0 gap-2 text-xs tracking-widest uppercase"
                data-testid="button-refresh"
              >
                <RefreshCw
                  className={`w-4 h-4 ${analytics.isFetching ? "animate-spin" : ""}`}
                  strokeWidth={1.5}
                />
                Refresh
              </Button>
            </header>

            <Dashboard data={analytics.data} />
          </>
        )}
      </div>
    </PageShell>
  );
}

/**
 * A signed-in session the server refused. Two things land here — an account
 * that isn't on the staff allowlist, and a staff account that signed in with a
 * password or magic link when Google is required — so the server's own message
 * is shown rather than a guess. Both get the Google button: for the second case
 * it's the fix, and for the first it changes nothing (the same 403 comes back),
 * so no one is told which side of the gate they failed on by what's offered.
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
      <h1 className="text-3xl font-serif mb-4">Studio access only</h1>
      <p className="text-muted-foreground max-w-md mx-auto">
        {reason ??
          "This page is for the atelier team. Your account is signed in, but it isn't a studio account."}
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
    <div className="space-y-12">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
    </div>
  );
}

// --- Chrome ---

function Section({
  icon,
  title,
  note,
  children,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  note?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId}>
      <h2 className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
        {icon}
        {title}
      </h2>
      <div className="rounded-sm border border-border bg-card/40 p-5">
        {children}
      </div>
      {note && (
        <p className="mt-2 text-xs text-muted-foreground/80 font-light">
          {note}
        </p>
      )}
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
      className="rounded-sm border border-border bg-card/40 p-4"
      data-testid={testId}
    >
      <p className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground mb-2">
        {label}
      </p>
      <p
        className={`text-2xl font-serif ${
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

/** A labelled horizontal bar, sized against the largest value in its group. */
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
    <div className="flex items-center gap-3 text-sm">
      <span className="w-36 shrink-0 truncate text-muted-foreground font-light">
        {label}
      </span>
      <span className="flex-1 h-2 rounded-full bg-muted/60 overflow-hidden">
        <span
          className="block h-full bg-primary/70"
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="w-20 shrink-0 text-right tabular-nums">
        {display ?? value}
      </span>
    </div>
  );
}

// --- Panels ---

function ProductionPanel({ production }: { production: StudioProductionLoad }) {
  return (
    <Section
      icon={<Hammer className="w-4 h-4" strokeWidth={1.5} />}
      title="Production load"
      testId="panel-production"
      note={
        production.unscheduled > 0
          ? `${production.unscheduled} active order${
              production.unscheduled === 1 ? "" : "s"
            } have no due date, so they don't appear on the schedule.`
          : undefined
      }
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
              className="flex items-baseline justify-between gap-3 py-2 text-sm"
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
      <p className="text-2xl font-serif">{value}</p>
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
    <Section
      icon={icon}
      title={title}
      testId={testId}
      note={`${pipeline.total} on record · ${pipeline.completed} finished · ${pipeline.cancelled} cancelled`}
    >
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

  return (
    <Section
      icon={<TrendingUp className="w-4 h-4" strokeWidth={1.5} />}
      title="By month"
      testId="panel-revenue"
      note="Shop revenue is money taken. Custom is work booked — the invoice total, placed in the month the order came in — so the two aren't added together."
    >
      <div className="flex items-center gap-4 mb-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-primary/70" />
          Shop taken {formatPrice(shopTotal)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-primary/30" />
          Custom booked {formatPrice(customTotal)}
        </span>
      </div>

      <div className="flex items-end gap-1.5 h-40" data-testid="revenue-chart">
        {months.map((month) => (
          <div
            key={month.month}
            className="flex-1 flex flex-col items-center gap-1 h-full justify-end"
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
      note={`${formatPrice(payments.invoicedTotal)} invoiced across ${
        payments.invoiceCount
      } invoice${payments.invoiceCount === 1 ? "" : "s"} · ${formatPrice(
        payments.collectedTotal,
      )} collected`}
    >
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
      note="Counted as orders containing the piece — the inventory link records what was bought, not how many."
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
function errorMessage(error: unknown): string | undefined {
  const data = (error as { data?: unknown } | null)?.data;
  const message = (data as { error?: unknown } | null)?.error;
  return typeof message === "string" && message.trim() ? message : undefined;
}

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
