import { useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import {
  useGetAppointment,
  getGetAppointmentQueryKey,
  type AppointmentDetails,
} from "@workspace/api-client-react";
import { ctaVariants } from "@/components/cta";
import { PageShell } from "@/components/page-shell";
import { SuccessScreen } from "@/components/success-screen";
import { Seo } from "@/components/seo";
import { AppointmentManagePanel } from "@/components/appointment-manage-panel";
import { fmtWhen } from "@/lib/appointment-format";
import { CalendarCheck, CalendarX } from "lucide-react";

/** A read-only summary card of the appointment's current details. */
function DetailsCard({ appt }: { appt: AppointmentDetails }) {
  return (
    <div className="border border-border rounded-lg p-6 text-left space-y-2">
      <p className="text-sm">
        <span className="text-muted-foreground">Appointment:</span>{" "}
        {appt.typeName} with {appt.staff}
      </p>
      <p className="text-sm">
        <span className="text-muted-foreground">When:</span>{" "}
        {fmtWhen(appt.start, appt.timezone)}
      </p>
      <p className="text-sm">
        <span className="text-muted-foreground">Where:</span>{" "}
        {appt.locationLabel}
      </p>
      {appt.meetingUrl && (
        <p className="text-sm">
          <span className="text-muted-foreground">Join link:</span>{" "}
          <a
            href={appt.meetingUrl}
            className="text-primary underline underline-offset-2 break-all"
            target="_blank"
            rel="noreferrer"
          >
            {appt.meetingUrl}
          </a>
        </p>
      )}
      <p className="text-sm">
        <span className="text-muted-foreground">Confirmation:</span>{" "}
        <span className="font-mono tracking-wider text-primary">
          {appt.confirmationCode}
        </span>
      </p>
    </div>
  );
}

export default function AppointmentManage() {
  const search = useSearch();
  const token = useMemo(
    () => new URLSearchParams(search).get("token") ?? "",
    [search],
  );

  const [outcome, setOutcome] = useState<{
    kind: "rescheduled" | "cancelled";
    details?: AppointmentDetails;
  } | null>(null);

  const appointmentQuery = useGetAppointment(
    { token },
    {
      query: {
        enabled: Boolean(token),
        retry: false,
        queryKey: getGetAppointmentQueryKey({ token }),
      },
    },
  );
  const appt = appointmentQuery.data;

  // --- Outcome screens -----------------------------------------------------
  if (outcome?.kind === "rescheduled") {
    return (
      <SuccessScreen
        icon={CalendarCheck}
        title="Your appointment is rescheduled"
        description="We've sent an updated confirmation to your email."
      >
        <Seo
          title="Appointment Rescheduled | A.A Atelier"
          description="Your appointment with A.A Atelier has been rescheduled."
          path="/appointments/manage"
          noindex
        />
        {outcome.details && <DetailsCard appt={outcome.details} />}
      </SuccessScreen>
    );
  }
  if (outcome?.kind === "cancelled") {
    return (
      <SuccessScreen
        icon={CalendarX}
        title="Your appointment is cancelled"
        description="We've released the time and sent you a confirmation. You're welcome to book again whenever you're ready."
        footer={
          <Link
            href="/appointments"
            className={ctaVariants({ variant: "primary", size: "lg" })}
          >
            Book a new appointment
          </Link>
        }
      >
        <Seo
          title="Appointment Cancelled | A.A Atelier"
          description="Your appointment with A.A Atelier has been cancelled."
          path="/appointments/manage"
          noindex
        />
      </SuccessScreen>
    );
  }

  // --- Loading / error / not-found -----------------------------------------
  const shell = (children: React.ReactNode) => (
    <PageShell align="top" noise={false}>
      <Seo
        title="Manage Appointment | A.A Atelier"
        description="Reschedule or cancel your A.A Atelier appointment."
        path="/appointments/manage"
        noindex
      />
      <div className="max-w-2xl w-full mx-auto px-6 pt-24 pb-20">
        {children}
      </div>
    </PageShell>
  );

  if (!token) {
    return shell(
      <p className="text-muted-foreground font-light">
        This link is missing its appointment token. Please use the link from
        your confirmation email.
      </p>,
    );
  }
  if (appointmentQuery.isLoading) {
    return shell(
      <p className="text-muted-foreground font-light">
        Loading your appointment…
      </p>,
    );
  }
  if (appointmentQuery.isError || !appt) {
    const message =
      appointmentQuery.error?.data?.error ||
      "We couldn't find that appointment. It may have already been cancelled, or the link may have expired.";
    return shell(
      <div className="space-y-6">
        <h1 className="text-3xl font-serif text-foreground">
          Appointment unavailable
        </h1>
        <p className="text-muted-foreground font-light">{message}</p>
        <Link
          href="/appointments"
          className="text-primary underline underline-offset-2"
        >
          Book a new appointment
        </Link>
      </div>,
    );
  }

  // --- Main --------------------------------------------------------------
  return shell(
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-3">
          Your appointment
        </h1>
        {appt.status === "cancelled" ? (
          <p className="text-muted-foreground font-light text-lg">
            This appointment has been cancelled.
          </p>
        ) : appt.canModify ? (
          <p className="text-muted-foreground font-light text-lg">
            Reschedule or cancel below — we'll update your calendar invitation
            automatically.
          </p>
        ) : (
          <p className="text-muted-foreground font-light text-lg">
            This appointment can no longer be changed online. Please contact us
            if you need to make a change.
          </p>
        )}
      </div>

      <DetailsCard appt={appt} />

      <AppointmentManagePanel
        appt={appt}
        token={token}
        onRescheduled={(details) =>
          setOutcome({ kind: "rescheduled", details })
        }
        onCancelled={() => setOutcome({ kind: "cancelled" })}
      />
    </div>,
  );
}
