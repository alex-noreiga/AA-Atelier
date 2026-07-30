import { Link, Redirect, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAccountOverview,
  useLogoutAccount,
  getGetAccountOverviewQueryKey,
  type AccountOrderSummary,
  type AccountShopOrderSummary,
  type AccountAppointmentSummary,
  type AccountMeasurements,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { Seo } from "@/components/seo";
import { AppointmentManagePanel } from "@/components/appointment-manage-panel";
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
} from "lucide-react";

/**
 * The customer account portal dashboard. Gathers the signed-in customer's custom
 * orders and shop orders — looked up by the session email, no order number to
 * remember — behind the magic-link identity. The cards link out to the existing
 * detail surfaces (`/track`, `/invoice/:n`) rather than re-implementing them, so
 * this is a home base, not a fork of the tracking pages.
 *
 * Auth is the session cookie: an unauthenticated visit gets a 401 from the
 * overview endpoint, which redirects here to the sign-in page.
 */
export default function Account() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const overview = useGetAccountOverview({
    query: {
      queryKey: getGetAccountOverviewQueryKey(),
      retry: false, // A 401 (not signed in) must not retry — redirect instead.
    },
  });

  const logout = useLogoutAccount({
    mutation: {
      onSuccess: () => {
        // Drop the cached overview so a later sign-in refetches fresh data.
        queryClient.removeQueries({
          queryKey: getGetAccountOverviewQueryKey(),
        });
        navigate("/account/login");
      },
    },
  });

  // Not signed in (or the session expired) → send them to sign in.
  const status = (overview.error as { status?: number } | null)?.status;
  if (overview.isError && status === 401) {
    return <Redirect to="/account/login" replace />;
  }

  return (
    <PageShell align="top" className="pt-28 pb-20">
      <Seo {...ROUTE_SEO["/account"]} />
      <div className="w-full max-w-2xl z-10 mx-auto px-6 animate-in fade-in duration-700">
        {overview.isLoading ? (
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
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
                className="text-muted-foreground hover:text-primary shrink-0 gap-2 text-xs tracking-widest uppercase"
                data-testid="button-sign-out"
              >
                <LogOut className="w-4 h-4" strokeWidth={1.5} />
                Sign out
              </Button>
            </header>

            {(() => {
              const appointments = overview.data.appointments ?? [];
              const { customOrders, shopOrders } = overview.data;
              if (
                customOrders.length === 0 &&
                shopOrders.length === 0 &&
                appointments.length === 0
              ) {
                return <EmptyState />;
              }
              return (
                <div className="space-y-12">
                  {appointments.length > 0 && (
                    <Section
                      icon={
                        <CalendarClock className="w-4 h-4" strokeWidth={1.5} />
                      }
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

                  {customOrders.length > 0 && (
                    <Section
                      icon={<Package className="w-4 h-4" strokeWidth={1.5} />}
                      title="Custom orders"
                    >
                      {customOrders.map((order) => (
                        <CustomOrderCard
                          key={order.orderNumber}
                          order={order}
                        />
                      ))}
                    </Section>
                  )}

                  {shopOrders.length > 0 && (
                    <Section
                      icon={
                        <ShoppingBag className="w-4 h-4" strokeWidth={1.5} />
                      }
                      title="Shop orders"
                    >
                      {shopOrders.map((order) => (
                        <ShopOrderCard key={order.orderNumber} order={order} />
                      ))}
                    </Section>
                  )}
                </div>
              );
            })()}
          </>
        )}
      </div>
    </PageShell>
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
  const index = order.stages.indexOf(order.currentStage);
  const progress =
    index >= 0 && order.stages.length > 0
      ? `Stage ${index + 1} of ${order.stages.length}`
      : null;
  const completion = formatDate(order.estimatedCompletion);

  return (
    <div
      className="rounded-sm border border-border bg-card/40 p-5"
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
      <p className="text-sm text-muted-foreground mt-1">
        {order.currentStage || "In progress"}
        {progress && (
          <span className="text-muted-foreground/60"> · {progress}</span>
        )}
      </p>
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
          View progress <ArrowRight className="w-3 h-3" />
        </Link>
        <Link
          to={`/invoice/${encodeURIComponent(order.orderNumber)}`}
          className="inline-flex items-center gap-1 text-xs tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
          data-testid={`link-invoice-${order.orderNumber}`}
        >
          Invoice &amp; payments
        </Link>
      </div>
    </div>
  );
}

function ShopOrderCard({ order }: { order: AccountShopOrderSummary }) {
  return (
    <div
      className="rounded-sm border border-border bg-card/40 p-5"
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
      <p className="text-sm text-muted-foreground mt-1">
        {order.status || "Processing"}
      </p>
      <div className="mt-4">
        <Link
          to={`/track?orderNumber=${encodeURIComponent(order.orderNumber)}`}
          className="inline-flex items-center gap-1 text-xs tracking-widest uppercase text-primary hover:opacity-70 transition-opacity"
          data-testid={`link-track-${order.orderNumber}`}
        >
          Track order <ArrowRight className="w-3 h-3" />
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
