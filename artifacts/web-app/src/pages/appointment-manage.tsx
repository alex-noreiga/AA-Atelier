import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import {
  useGetAppointment,
  getGetAppointmentQueryKey,
  useGetAppointmentAvailability,
  getGetAppointmentAvailabilityQueryKey,
  useRescheduleAppointment,
  useCancelAppointment,
  type AppointmentDetails,
  type GetAppointmentAvailabilityParams,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ctaVariants } from "@/components/cta";
import { PageShell } from "@/components/page-shell";
import { SuccessScreen } from "@/components/success-screen";
import { Seo } from "@/components/seo";
import { useToast } from "@/hooks/use-toast";
import {
  WINDOW_DAYS,
  fmtDayLabel,
  fmtTime,
  fmtWhen,
  groupSlotsByDate,
} from "@/lib/appointment-format";
import {
  ArrowLeft,
  CalendarCheck,
  CalendarX,
  Clock,
  Loader2,
} from "lucide-react";

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
  const { toast } = useToast();

  const [mode, setMode] = useState<"view" | "reschedule" | "confirm-cancel">(
    "view",
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
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
  const timezone = appt?.timezone ?? "America/Chicago";

  // Reschedule availability — locked to the same type, location, and staff so the
  // event stays on that staff member's calendar (a reschedule is a move, not a
  // rebooking). Only fetched once the customer opts to reschedule.
  const availabilityParams: GetAppointmentAvailabilityParams | null = appt
    ? {
        typeId: appt.typeId,
        location: appt.location,
        staff: appt.staff,
        days: WINDOW_DAYS,
      }
    : null;
  const availabilityQuery = useGetAppointmentAvailability(
    availabilityParams ?? { typeId: "", location: "in-person" },
    {
      query: {
        enabled: mode === "reschedule" && Boolean(availabilityParams),
        queryKey: getGetAppointmentAvailabilityQueryKey(
          availabilityParams ?? { typeId: "", location: "in-person" },
        ),
        staleTime: 30_000,
      },
    },
  );

  const slotsByDate = useMemo(
    () => groupSlotsByDate(availabilityQuery.data?.slots ?? [], timezone),
    [availabilityQuery.data, timezone],
  );
  const availableDates = useMemo(() => [...slotsByDate.keys()], [slotsByDate]);

  useEffect(() => {
    if (availableDates.length === 0) {
      setSelectedDate(null);
    } else if (!selectedDate || !availableDates.includes(selectedDate)) {
      setSelectedDate(availableDates[0]);
    }
  }, [availableDates, selectedDate]);

  const reschedule = useRescheduleAppointment({
    mutation: {
      onSuccess: (data) => setOutcome({ kind: "rescheduled", details: data }),
      onError: (error) =>
        toast({
          variant: "destructive",
          title: "Couldn't reschedule",
          description:
            error.data?.error ||
            error.message ||
            "That time may no longer be available. Please choose another.",
        }),
    },
  });

  const cancel = useCancelAppointment({
    mutation: {
      onSuccess: () => setOutcome({ kind: "cancelled" }),
      onError: (error) =>
        toast({
          variant: "destructive",
          title: "Couldn't cancel",
          description:
            error.data?.error ||
            error.message ||
            "Something went wrong. Please try again.",
        }),
    },
  });

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

      {appt.status === "confirmed" && appt.canModify && mode === "view" && (
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={() => setMode("reschedule")}
            className="bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-5 rounded-full tracking-widest uppercase text-xs"
            data-testid="button-reschedule"
          >
            Reschedule
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setMode("confirm-cancel")}
            className="px-8 py-5 rounded-full tracking-widest uppercase text-xs"
            data-testid="button-cancel"
          >
            Cancel appointment
          </Button>
        </div>
      )}

      {/* Cancel confirmation (inline — no extra dialog dependency). */}
      {mode === "confirm-cancel" && (
        <div
          className="border border-destructive/40 bg-destructive/[0.04] rounded-lg p-6 space-y-4"
          data-testid="cancel-confirm"
        >
          <p className="text-sm text-foreground">
            Cancel this appointment? This frees the time for others and can't be
            undone — you'd need to book again.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate({ data: { token } })}
              className="rounded-full tracking-widest uppercase text-xs px-6"
              data-testid="button-confirm-cancel"
            >
              {cancel.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Cancelling…
                </>
              ) : (
                "Yes, cancel it"
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMode("view")}
              className="rounded-full tracking-widest uppercase text-xs px-6"
            >
              Keep appointment
            </Button>
          </div>
        </div>
      )}

      {/* Reschedule picker. */}
      {mode === "reschedule" && (
        <section data-testid="reschedule-picker" className="space-y-6">
          <button
            type="button"
            onClick={() => setMode("view")}
            className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors tracking-widest uppercase group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Back
          </button>

          <div>
            <h2 className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-2">
              Choose a new time
            </h2>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Times shown in {timezone.replace(/_/g, " ")}.
            </p>
          </div>

          {availabilityQuery.isLoading && (
            <p className="text-muted-foreground font-light">
              Finding open times…
            </p>
          )}
          {availabilityQuery.isError && (
            <p className="text-destructive text-sm">
              We couldn't load available times. Please try again shortly.
            </p>
          )}
          {availabilityQuery.isSuccess && availableDates.length === 0 && (
            <p className="text-muted-foreground font-light">
              No open times in the next {WINDOW_DAYS} days. Please check back
              soon or contact us to reschedule.
            </p>
          )}

          {availableDates.length > 0 && (
            <>
              <div className="flex gap-2 overflow-x-auto pb-3">
                {availableDates.map((dateKey) => {
                  const iso = slotsByDate.get(dateKey)![0];
                  const { weekday, date } = fmtDayLabel(iso, timezone);
                  const active = selectedDate === dateKey;
                  return (
                    <button
                      key={dateKey}
                      type="button"
                      onClick={() => setSelectedDate(dateKey)}
                      data-testid={`date-${dateKey}`}
                      className={`flex-shrink-0 w-16 py-3 rounded-lg border text-center transition-all ${
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      <span className="block text-[10px] tracking-widest uppercase">
                        {weekday}
                      </span>
                      <span className="block text-sm mt-1">{date}</span>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                {(selectedDate
                  ? (slotsByDate.get(selectedDate) ?? [])
                  : []
                ).map((iso) => (
                  <button
                    key={iso}
                    type="button"
                    disabled={reschedule.isPending}
                    onClick={() =>
                      reschedule.mutate({ data: { token, start: iso } })
                    }
                    data-testid={`slot-${iso}`}
                    className="py-2.5 rounded-lg border border-border text-sm text-foreground hover:border-primary hover:bg-primary/10 hover:text-primary transition-all disabled:opacity-50"
                  >
                    {fmtTime(iso, timezone)}
                  </button>
                ))}
              </div>
              {reschedule.isPending && (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Moving your appointment…
                </p>
              )}
            </>
          )}
        </section>
      )}
    </div>,
  );
}
