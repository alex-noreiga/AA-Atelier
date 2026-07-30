import { useEffect, useMemo, useState } from "react";
import {
  useGetAppointmentAvailability,
  getGetAppointmentAvailabilityQueryKey,
  useRescheduleAppointment,
  useCancelAppointment,
  type AppointmentDetails,
  type GetAppointmentAvailabilityParams,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  WINDOW_DAYS,
  fmtDayLabel,
  fmtTime,
  groupSlotsByDate,
} from "@/lib/appointment-format";
import { ArrowLeft, Clock, Loader2 } from "lucide-react";

/**
 * The interactive reschedule / cancel controls for a single booked appointment,
 * driven by its signed manage token. Shared by the self-service manage page
 * (`/appointments/manage`, keyed by the emailed token) and the account portal
 * (keyed by the per-appointment token the overview mints), so the two can't drift.
 *
 * The panel owns only the interaction (mode + the two mutations); it reports
 * success back through `onRescheduled` / `onCancelled` and lets the parent decide
 * what to show next — a full success screen on the manage page, an in-place list
 * refresh in the portal.
 */
export function AppointmentManagePanel({
  appt,
  token,
  onRescheduled,
  onCancelled,
}: {
  appt: AppointmentDetails;
  token: string;
  onRescheduled: (details: AppointmentDetails) => void;
  onCancelled: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"view" | "reschedule" | "confirm-cancel">(
    "view",
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const timezone = appt.timezone;

  // Reschedule availability — locked to the same type, location, and staff so the
  // event stays on that staff member's calendar (a reschedule is a move, not a
  // rebooking). Only fetched once the customer opts to reschedule.
  const availabilityParams: GetAppointmentAvailabilityParams = {
    typeId: appt.typeId,
    location: appt.location,
    staff: appt.staff,
    days: WINDOW_DAYS,
  };
  const availabilityQuery = useGetAppointmentAvailability(availabilityParams, {
    query: {
      enabled: mode === "reschedule",
      queryKey: getGetAppointmentAvailabilityQueryKey(availabilityParams),
      staleTime: 30_000,
    },
  });

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
      onSuccess: (data) => {
        setMode("view");
        onRescheduled(data);
      },
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
      onSuccess: () => onCancelled(),
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

  // Nothing to do once the appointment can no longer be changed.
  if (appt.status !== "confirmed" || !appt.canModify) return null;

  return (
    <>
      {mode === "view" && (
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
            Cancel this appointment? This frees the time for others and
            can&apos;t be undone — you&apos;d need to book again.
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
              We couldn&apos;t load available times. Please try again shortly.
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
    </>
  );
}
