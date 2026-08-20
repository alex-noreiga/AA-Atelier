import { useState } from "react";
import { Link, Redirect, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAccountOverview,
  getGetAccountOverviewQueryKey,
  type AccountOverview,
  type AccountOrderState,
  type AccountOrderSummary,
  type AccountShopOrderSummary,
  type AccountAppointmentSummary,
  type AccountMeasurements,
  type AccountReferral,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { Seo } from "@/components/seo";
import { AppointmentManagePanel } from "@/components/appointment-manage-panel";
import { useAuth } from "@/lib/auth-context";
import { useStudioAccess } from "@/lib/studio-access";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { formatPrice, formatDate } from "@/lib/format";
import { fmtWhen } from "@/lib/appointment-format";
import {
  Loader2,
  ArrowRight,
  LogOut,
  Package,
  ShoppingBag,
  CalendarClock,
  Video,
  Ruler,
  Gift,
  Copy,
  Check,
  CheckCircle2,
  Archive,
  ChevronDown,
  ChevronUp,
  Ban,
} from "lucide-react";

/**
 * The customer account portal dashboard. Gathers the signed-in customer's custom
 * orders, shop orders, and upcoming appointments — looked up by the signed-in
 * email, no order number to remember. The cards link out to the existing detail
 * surfaces (`/track`, `/invoice/:n`) rather than re-implementing them, so this is
 * a home base, not a fork of the tracking pages.
 *
 * Auth is a Supabase Auth session (email+password / Google / magic link), held
 * by supabase-js in the browser; its access token rides every API call as a
 * Bearer credential. An unauthenticated visit is redirected to the sign-in page
 * — driven off the client-side session, with the overview's 401 as a fallback.
 *
 * A *studio staff* session is handed on to `/studio` instead. Staff don't place
 * orders through the shop, so this page is empty by construction for them —
 * and since sign-in and the OAuth callback both land here by default, doing the
 * hand-off at this one door covers every way in rather than each of them.
 */
export default function Account() {
  const [, navigate] = useLocation();
  const { session, loading, signOut } = useAuth();
  const { staff, loading: staffLoading } = useStudioAccess();

  const overview = useGetAccountOverview({
    query: {
      queryKey: getGetAccountOverviewQueryKey(),
      // Only fetch once we know there's a session; a 401 must not retry.
      enabled: !loading && Boolean(session),
      retry: false,
    },
  });

  const handleSignOut = async () => {
    await signOut();
    navigate("/account/login");
  };

  // Not signed in (or the session expired) → send them to sign in. Prefer the
  // client-side session; fall back to a server 401 (e.g. a token rejected
  // server-side while the client still holds it).
  const status = (overview.error as { status?: number } | null)?.status;
  if ((!loading && !session) || (overview.isError && status === 401)) {
    return <Redirect to="/account/login" replace />;
  }

  // Studio staff get the dashboard, not a customer portal with nothing in it.
  // The loader below waits on the staff answer as well as the overview, so this
  // is reached with a settled answer and no flash of the wrong page in between.
  if (staff) {
    return <Redirect to="/studio" replace />;
  }

  return (
    <PageShell align="top" className="pt-28 pb-20">
      <Seo {...ROUTE_SEO["/account"]} />
      <div className="w-full max-w-2xl z-10 mx-auto px-6 animate-in fade-in duration-700">
        {loading ||
        staffLoading ||
        overview.isLoading ||
        (Boolean(session) && overview.isPending) ? (
          <div
            className="flex items-center justify-center py-24"
            data-testid="account-loading"
          >
            <Loader2
              className="w-6 h-6 animate-spin text-primary"
              strokeWidth={1}
            />
          </div>
        ) : overview.isError || !overview.data ? (
          <div className="text-center py-16" data-testid="account-error">
            <h1 className="text-3xl font-serif mb-4">Something went wrong</h1>
            <p className="text-muted-foreground">
              We couldn&apos;t load your account just now. Please try again in a
              moment.
            </p>
          </div>
        ) : (
          <>
            <header className="flex items-start justify-between gap-4 mb-12">
              <div>
                <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-2">
                  Your Account
                </h1>
                <p className="text-muted-foreground font-light break-all">
                  {overview.data.email}
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={handleSignOut}
                className="text-muted-foreground hover:text-primary shrink-0 gap-2 text-xs tracking-widest uppercase"
                data-testid="button-sign-out"
              >
                <LogOut className="w-4 h-4" strokeWidth={1.5} />
                Sign out
              </Button>
            </header>

            {overview.data.referral && (
              <div className="mb-12">
                <ReferralCard referral={overview.data.referral} />
              </div>
            )}

            <Dashboard data={overview.data} />
          </>
        )}
      </div>
    </PageShell>
  );
}

/**
 * The dashboard body, split by where each order sits in its lifecycle: what's
 * still moving stays at the top, and everything finished or cancelled collects
 * in one "Past orders" section below (collapsed by default, so a customer with
 * years of history still opens onto their live work). Each finished order also
 * carries an explicit badge, so completion is never something the customer has
 * to infer from a stage name.
 *
 * Mounted only once the overview has loaded, so the collapse default can be
 * decided from the real data on first render.
 */
function Dashboard({ data }: { data: AccountOverview }) {
  const appointments = data.appointments ?? [];
  const isActive = (o: { state: AccountOrderState }) => o.state === "active";
  const activeCustom = data.customOrders.filter(isActive);
  const activeShop = data.shopOrders.filter(isActive);
  const pastCustom = data.customOrders.filter((o) => !isActive(o));
  const pastShop = data.shopOrders.filter((o) => !isActive(o));
  const pastCount = pastCustom.length + pastShop.length;

  const nothingCurrent =
    appointments.length === 0 &&
    activeCustom.length === 0 &&
    activeShop.length === 0;

  // Expanded when there's nothing current to show, so the page never opens on
  // an apparently empty account that in fact has history.
  const [showPast, setShowPast] = useState(nothingCurrent);

  if (nothingCurrent && pastCount === 0) return <EmptyState />;

  return (
    <div className="space-y-12">
      {appointments.length > 0 && (
        <Section
          icon={<CalendarClock className="w-4 h-4" strokeWidth={1.5} />}
          title="Upcoming appointments"
        >
          {appointments.map((appt) => (
            <AppointmentCard
              key={`${appt.staff}-${appt.confirmationCode}-${String(appt.start)}`}
              appt={appt}
            />
          ))}
        </Section>
      )}

      {activeCustom.length > 0 && (
        <Section
          icon={<Package className="w-4 h-4" strokeWidth={1.5} />}
          title="Custom orders"
        >
          {activeCustom.map((order) => (
            <CustomOrderCard key={order.orderNumber} order={order} />
          ))}
        </Section>
      )}

      {activeShop.length > 0 && (
        <Section
          icon={<ShoppingBag className="w-4 h-4" strokeWidth={1.5} />}
          title="Shop orders"
        >
          {activeShop.map((order) => (
            <ShopOrderCard key={order.orderNumber} order={order} />
          ))}
        </Section>
      )}

      {pastCount > 0 && (
        <section data-testid="past-orders">
          <h2 className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
            <Archive className="w-4 h-4" strokeWidth={1.5} />
            Past orders
            <span className="text-muted-foreground/60 normal-case tracking-normal">
              ({pastCount})
            </span>
            <button
              type="button"
              onClick={() => setShowPast((open) => !open)}
              className="ml-auto inline-flex items-center gap-1 text-xs tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
              aria-expanded={showPast}
              data-testid="button-toggle-past-orders"
            >
              {showPast ? "Hide" : "Show"}
              {showPast ? (
                <ChevronUp className="w-3.5 h-3.5" strokeWidth={1.5} />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.5} />
              )}
            </button>
          </h2>
          {showPast && (
            <div className="space-y-3">
              {pastCustom.map((order) => (
                <CustomOrderCard key={order.orderNumber} order={order} />
              ))}
              {pastShop.map((order) => (
                <ShopOrderCard key={order.orderNumber} order={order} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** How a finished or cancelled order is denoted on its card. Active orders show
 * nothing — the stage line already says where they are.
 *
 * The contract's finished state is the kind-neutral `completed` (it covers a
 * custom garment and a shop parcel alike); the customer-facing word is the
 * atelier's own — "Delivered". */
function StateBadge({ state }: { state: AccountOrderState }) {
  if (state === "active") return null;
  const completed = state === "completed";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] tracking-[0.15em] uppercase ${
        completed
          ? "border-primary/40 text-primary"
          : "border-border text-muted-foreground"
      }`}
      data-testid={`order-state-${state}`}
    >
      {completed ? (
        <CheckCircle2 className="w-3 h-3" strokeWidth={1.5} />
      ) : (
        <Ban className="w-3 h-3" strokeWidth={1.5} />
      )}
      {completed ? "Delivered" : "Cancelled"}
    </span>
  );
}

/** Card chrome, dimmed a touch once an order is no longer active. */
function cardClass(state: AccountOrderState): string {
  return state === "active"
    ? "rounded-sm border border-border bg-card/40 p-5"
    : "rounded-sm border border-border/60 bg-card/20 p-5";
}

/** The customer's referral code + a standing returning-skater discount, when
 * earned. The code redeems as a Stripe promotion code at any checkout. */
function ReferralCard({ referral }: { referral: AccountReferral }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(value);
      window.setTimeout(() => setCopied((c) => (c === value ? null : c)), 2000);
    });
  };

  const creditLabel =
    typeof referral.creditAmount === "number" && referral.creditAmount > 0
      ? `$${referral.creditAmount.toFixed(2).replace(/\.00$/, "")}`
      : null;

  return (
    <div
      className="rounded-sm border border-border bg-card/40 p-5"
      data-testid="referral-card"
    >
      <h2 className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
        <Gift className="w-4 h-4" strokeWidth={1.5} />
        Refer a friend
      </h2>
      <p className="text-sm text-muted-foreground font-light mb-4">
        {creditLabel
          ? `Share your code with a fellow skater. When they place their first order, you'll earn ${creditLabel} in credit — and they'll get a welcome discount too.`
          : "Share your code with a fellow skater. When they place their first order, you'll earn a credit — and they'll get a welcome discount too."}
      </p>
      <CodeRow
        code={referral.code}
        copied={copied === referral.code}
        onCopy={() => copy(referral.code)}
        testId="referral-code"
      />

      {referral.returningCode && (
        <div className="mt-5 pt-4 border-t border-border/60">
          <p className="text-[11px] tracking-widest uppercase text-muted-foreground/70 mb-2">
            Your returning-skater discount
          </p>
          <CodeRow
            code={referral.returningCode}
            copied={copied === referral.returningCode}
            onCopy={() => copy(referral.returningCode as string)}
            testId="returning-code"
          />
        </div>
      )}
    </div>
  );
}

function CodeRow({
  code,
  copied,
  onCopy,
  testId,
}: {
  code: string;
  copied: boolean;
  onCopy: () => void;
  testId: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="inline-block border border-border rounded-sm px-4 py-2.5 font-mono text-base tracking-[0.12em] text-foreground"
        data-testid={testId}
      >
        {code}
      </span>
      <Button
        variant="ghost"
        onClick={onCopy}
        className="text-muted-foreground hover:text-primary gap-1.5 text-xs tracking-widest uppercase"
        data-testid={`${testId}-copy`}
      >
        {copied ? (
          <Check className="w-4 h-4" strokeWidth={1.5} />
        ) : (
          <Copy className="w-4 h-4" strokeWidth={1.5} />
        )}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
        {icon}
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** The measurements on file for an order, shown read-only. Editing still goes
 * through the measurement-change request on the tracking page. */
function MeasurementsBlock({
  measurements,
}: {
  measurements: AccountMeasurements;
}) {
  const rows: Array<[string, number | undefined]> = [
    ["Waist", measurements.waist],
    ["Chest", measurements.bust],
    ["Hips", measurements.hips],
    ["Height", measurements.height],
    ["Body Girth", measurements.bodyGirth],
  ];
  const present = rows.filter(
    (row): row is [string, number] => typeof row[1] === "number",
  );
  if (present.length === 0) return null;

  return (
    <div className="mt-4 pt-4 border-t border-border/60">
      <p className="flex items-center gap-2 text-[11px] tracking-widest uppercase text-muted-foreground/70 mb-2">
        <Ruler className="w-3 h-3" strokeWidth={1.5} />
        Measurements ({measurements.unit})
      </p>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
        {present.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-foreground tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function AppointmentCard({ appt }: { appt: AccountAppointmentSummary }) {
  const queryClient = useQueryClient();
  // A reschedule or cancel changes the booking (and mints a stale manage token),
  // so refetch the overview to show the new state in place.
  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: getGetAccountOverviewQueryKey(),
    });
  };

  return (
    <div
      className="rounded-sm border border-border bg-card/40 p-5"
      data-testid={`appointment-${appt.confirmationCode}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-lg text-foreground">{appt.typeName}</h3>
        <span className="text-xs tracking-widest uppercase text-muted-foreground shrink-0">
          {appt.locationLabel}
        </span>
      </div>
      <p className="text-sm text-muted-foreground mt-1">
        {fmtWhen(appt.start, appt.timezone)}
      </p>
      <p className="text-xs text-muted-foreground/70 mt-1">With {appt.staff}</p>
      {appt.meetingUrl && (
        <a
          href={appt.meetingUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs tracking-widest uppercase text-primary hover:opacity-70 transition-opacity mt-3"
        >
          <Video className="w-3.5 h-3.5" strokeWidth={1.5} />
          Join link
        </a>
      )}
      <div className="mt-4">
        <AppointmentManagePanel
          appt={appt}
          token={appt.manageToken}
          onRescheduled={refresh}
          onCancelled={refresh}
        />
      </div>
    </div>
  );
}

function CustomOrderCard({ order }: { order: AccountOrderSummary }) {
  const active = order.state === "active";
  const index = order.stages.indexOf(order.currentStage);
  // "Stage 3 of 6" is progress through work still under way; a finished or
  // cancelled order needs its badge and its last stage, not a fraction.
  const progress =
    active && index >= 0 && order.stages.length > 0
      ? `Stage ${index + 1} of ${order.stages.length}`
      : null;
  // Likewise the due date: a target completion only means something while the
  // order is still working toward it.
  const completion = active ? formatDate(order.estimatedCompletion) : null;

  return (
    <div
      className={cardClass(order.state)}
      data-testid={`custom-order-${order.orderNumber}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-lg text-foreground">
          {order.orderName}
        </h3>
        <span className="text-xs tracking-widest uppercase text-muted-foreground shrink-0">
          {order.orderNumber}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2">
        <StateBadge state={order.state} />
        <p className="text-sm text-muted-foreground">
          {order.currentStage || "In progress"}
          {progress && (
            <span className="text-muted-foreground/60"> · {progress}</span>
          )}
        </p>
      </div>
      {completion && (
        <p className="text-xs text-muted-foreground/70 mt-1">
          Target completion {completion}
        </p>
      )}
      {order.measurements && (
        <MeasurementsBlock measurements={order.measurements} />
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4">
        <Link
          to={`/track?orderNumber=${encodeURIComponent(order.orderNumber)}`}
          className="inline-flex items-center gap-1 text-xs tracking-widest uppercase text-primary hover:opacity-70 transition-opacity"
          data-testid={`link-track-${order.orderNumber}`}
        >
          {active ? "View progress" : "View order"}{" "}
          <ArrowRight className="w-3 h-3" />
        </Link>
        {/* A cancelled order's payments are settled by the atelier's refund —
            don't point the customer back at a pay screen. */}
        {order.state !== "cancelled" && (
          <Link
            to={`/invoice/${encodeURIComponent(order.orderNumber)}`}
            className="inline-flex items-center gap-1 text-xs tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
            data-testid={`link-invoice-${order.orderNumber}`}
          >
            Invoice &amp; payments
          </Link>
        )}
      </div>
    </div>
  );
}

function ShopOrderCard({ order }: { order: AccountShopOrderSummary }) {
  const active = order.state === "active";

  return (
    <div
      className={cardClass(order.state)}
      data-testid={`shop-order-${order.orderNumber}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs tracking-widest uppercase text-muted-foreground">
          {order.orderNumber}
        </span>
        {typeof order.total === "number" && (
          <span className="font-serif text-foreground">
            {formatPrice(order.total)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2">
        <StateBadge state={order.state} />
        <p className="text-sm text-muted-foreground">
          {order.status || "Processing"}
        </p>
      </div>
      <div className="mt-4">
        <Link
          to={`/track?orderNumber=${encodeURIComponent(order.orderNumber)}`}
          className="inline-flex items-center gap-1 text-xs tracking-widest uppercase text-primary hover:opacity-70 transition-opacity"
          data-testid={`link-track-${order.orderNumber}`}
        >
          {active ? "Track order" : "View order"}{" "}
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16 space-y-6" data-testid="account-empty">
      <div className="w-12 h-[1px] bg-border mx-auto" />
      <p className="text-muted-foreground font-serif text-xl">
        Nothing here yet
      </p>
      <p className="text-muted-foreground font-light max-w-sm mx-auto">
        Orders you place with this email will appear here. If you have an order
        under a different address, you can still look it up by number.
      </p>
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 pt-2">
        <Link
          to="/order"
          className="text-xs tracking-widest uppercase text-primary hover:opacity-70 transition-opacity"
        >
          Start a custom order
        </Link>
        <Link
          to="/shop"
          className="text-xs tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
        >
          Visit the shop
        </Link>
        <Link
          to="/appointments"
          className="text-xs tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
        >
          Book an appointment
        </Link>
        <Link
          to="/track"
          className="text-xs tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
        >
          Look up by number
        </Link>
      </div>
    </div>
  );
}
