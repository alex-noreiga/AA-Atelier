import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useGetAppointmentOptions,
  useGetAppointmentAvailability,
  getGetAppointmentAvailabilityQueryKey,
  useCreateAppointment,
  type AppointmentType,
  type GetAppointmentAvailabilityParams,
  type NewAppointmentResponse,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageShell } from "@/components/page-shell";
import { Seo } from "@/components/seo";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, CalendarCheck, Check, Clock, Loader2 } from "lucide-react";

// "No preference" is a sentinel staff choice; it maps to omitting `staff` on the
// request so the server assigns whoever's free.
const NO_PREFERENCE = "__any__";
const WINDOW_DAYS = 21;

const LOCATION_LABELS: Record<string, string> = {
  "in-person": "In person",
  virtual: "Virtual",
};

const STEPS = ["Purpose", "Format", "Time", "Your details"] as const;

// --- timezone-aware formatting (the atelier zone comes from the API) ---------

function fmtDateKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function fmtDayLabel(
  iso: string,
  tz: string,
): { weekday: string; date: string } {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(new Date(iso));
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
  return { weekday, date };
}

function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function fmtWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

const detailsSchema = z.object({
  fullName: z.string().min(1, "Your name is required"),
  email: z.string().email("Please enter a valid email address"),
  phone: z.string().optional(),
  preferredContact: z.enum(["email", "phone", "text"]).optional(),
  notes: z.string().optional(),
});
type DetailsValues = z.infer<typeof detailsSchema>;

// Small selectable pill used across steps.
function OptionPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-full text-xs tracking-widest uppercase border transition-all ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:border-primary/50"
      }`}
    >
      {children}
    </button>
  );
}

export default function Appointments() {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [staff, setStaff] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [success, setSuccess] = useState<NewAppointmentResponse | null>(null);

  const optionsQuery = useGetAppointmentOptions();
  const options = optionsQuery.data;
  const timezone = options?.timezone ?? "America/New_York";
  const selectedType = options?.types.find((t) => t.id === typeId) ?? null;

  const staffParam = staff && staff !== NO_PREFERENCE ? staff : undefined;
  const ready = Boolean(typeId && location && staff);

  const availabilityParams: GetAppointmentAvailabilityParams = {
    typeId: typeId ?? "",
    location: (location ??
      "in-person") as GetAppointmentAvailabilityParams["location"],
    ...(staffParam ? { staff: staffParam } : {}),
    days: WINDOW_DAYS,
  };
  const availabilityQuery = useGetAppointmentAvailability(availabilityParams, {
    query: {
      enabled: ready && step === 2,
      queryKey: getGetAppointmentAvailabilityQueryKey(availabilityParams),
      staleTime: 30_000,
    },
  });

  // Group slots by local calendar date (in the atelier timezone).
  const slotsByDate = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const slot of availabilityQuery.data?.slots ?? []) {
      const key = fmtDateKey(slot.start, timezone);
      const list = groups.get(key) ?? [];
      list.push(slot.start);
      groups.set(key, list);
    }
    return groups;
  }, [availabilityQuery.data, timezone]);
  const availableDates = useMemo(() => [...slotsByDate.keys()], [slotsByDate]);

  // Default the selected date to the first one with openings.
  useEffect(() => {
    if (availableDates.length === 0) {
      setSelectedDate(null);
    } else if (!selectedDate || !availableDates.includes(selectedDate)) {
      setSelectedDate(availableDates[0]);
    }
  }, [availableDates, selectedDate]);

  const createAppointment = useCreateAppointment({
    mutation: {
      onSuccess: (data) => setSuccess(data),
      onError: (error) => {
        const message =
          error.data?.error ||
          error.message ||
          "Something went wrong. Please try again.";
        toast({
          variant: "destructive",
          title: "Couldn't book that time",
          description: message,
        });
      },
    },
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<DetailsValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { preferredContact: undefined },
  });
  const preferredContact = watch("preferredContact");

  function chooseType(type: AppointmentType) {
    setTypeId(type.id);
    const soleLocation = type.locations.length === 1 ? type.locations[0] : null;
    const soleStaff = type.staff.length === 1 ? type.staff[0] : null;
    setLocation(soleLocation);
    setStaff(soleStaff);
    setSelectedSlot(null);
    setSelectedDate(null);
    // Skip the Format step entirely when there's nothing to choose there.
    setStep(soleLocation && soleStaff ? 2 : 1);
  }

  function chooseSlot(iso: string) {
    setSelectedSlot(iso);
    setStep(3);
  }

  function onSubmitDetails(values: DetailsValues) {
    if (!typeId || !location || !selectedSlot) return;
    createAppointment.mutate({
      data: {
        typeId,
        location: location as "in-person" | "virtual",
        start: selectedSlot,
        ...(staffParam ? { staff: staffParam } : {}),
        fullName: values.fullName,
        email: values.email,
        ...(values.phone ? { phone: values.phone } : {}),
        ...(values.preferredContact
          ? { preferredContact: values.preferredContact }
          : {}),
        ...(values.notes ? { notes: values.notes } : {}),
      },
    });
  }

  // --- Success -------------------------------------------------------------
  if (success) {
    return (
      <PageShell noise={false}>
        <Seo
          title="Appointment Booked | A.A Atelier"
          description="Your appointment with A.A Atelier is confirmed."
          path="/appointments"
          noindex
        />
        <div className="w-full max-w-lg text-center animate-in fade-in zoom-in-95 duration-700">
          <CalendarCheck
            className="w-16 h-16 text-primary mx-auto mb-6"
            strokeWidth={1}
          />
          <h1 className="text-3xl font-serif mb-3">You're booked</h1>
          <p className="text-muted-foreground font-light mb-8">
            We've sent a confirmation to your email. We look forward to seeing
            you.
          </p>
          <div className="border border-border rounded-lg p-6 mb-8 text-left space-y-2">
            <p className="text-sm">
              <span className="text-muted-foreground">Appointment:</span>{" "}
              {success.type} with {success.staff}
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">When:</span>{" "}
              {fmtWhen(success.start, timezone)}
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Where:</span>{" "}
              {success.location}
            </p>
            {success.meetingUrl && (
              <p className="text-sm">
                <span className="text-muted-foreground">Join link:</span>{" "}
                <a
                  href={success.meetingUrl}
                  className="text-primary underline underline-offset-2 break-all"
                  target="_blank"
                  rel="noreferrer"
                >
                  {success.meetingUrl}
                </a>
              </p>
            )}
            <p className="text-sm">
              <span className="text-muted-foreground">Confirmation:</span>{" "}
              <span className="font-mono tracking-wider text-primary">
                {success.confirmationCode}
              </span>
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            We've sent a calendar invitation to your email. Need to change or
            cancel? Just reply to it.
          </p>
        </div>
      </PageShell>
    );
  }

  // --- Booking flow --------------------------------------------------------
  return (
    <PageShell align="top" noise={false}>
      <Seo
        title="Book an Appointment | A.A Atelier"
        description="Schedule a consultation, fitting, or design review with A.A Atelier. Pick a time that works for you and book online in a few steps."
        path="/appointments"
      />
      <div className="max-w-2xl w-full mx-auto px-6 pt-24 pb-16">
        <div className="mb-10">
          <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-3">
            Book an Appointment
          </h1>
          <p className="text-muted-foreground font-light text-lg">
            Consultations, fittings, and design reviews — choose a time that
            suits you.
          </p>
        </div>

        {/* Step indicator */}
        <ol className="flex items-center gap-2 mb-10 text-[11px] tracking-[0.15em] uppercase">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <span
                className={`flex items-center gap-1.5 ${
                  i === step
                    ? "text-primary"
                    : i < step
                      ? "text-foreground"
                      : "text-muted-foreground/50"
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] ${
                    i < step
                      ? "border-primary bg-primary/10 text-primary"
                      : i === step
                        ? "border-primary text-primary"
                        : "border-border"
                  }`}
                >
                  {i < step ? <Check className="w-3 h-3" /> : i + 1}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </span>
              {i < STEPS.length - 1 && (
                <span className="w-4 h-px bg-border" aria-hidden />
              )}
            </li>
          ))}
        </ol>

        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors tracking-widest uppercase mb-8 group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Back
          </button>
        )}

        {/* Step 0 — Purpose */}
        {step === 0 && (
          <section className="space-y-4" data-testid="step-purpose">
            {optionsQuery.isLoading && (
              <p className="text-muted-foreground font-light">Loading…</p>
            )}
            {optionsQuery.isError && (
              <p className="text-destructive text-sm">
                We couldn't load appointment options. Please try again shortly.
              </p>
            )}
            {options?.types.map((type) => (
              <button
                key={type.id}
                type="button"
                onClick={() => chooseType(type)}
                data-testid={`type-${type.id}`}
                className="w-full text-left border border-border rounded-lg p-5 hover:border-primary/60 hover:bg-primary/[0.03] transition-all group"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-serif text-xl text-foreground group-hover:text-primary transition-colors">
                    {type.name}
                  </h3>
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    {type.durationMinutes} min
                  </span>
                </div>
                {type.description && (
                  <p className="text-sm text-muted-foreground font-light mt-1.5">
                    {type.description}
                  </p>
                )}
              </button>
            ))}
          </section>
        )}

        {/* Step 1 — Format (location + staff) */}
        {step === 1 && selectedType && (
          <section className="space-y-10" data-testid="step-format">
            {selectedType.locations.length > 1 && (
              <div>
                <h2 className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4 pb-2 border-b border-border">
                  Where
                </h2>
                <div className="flex flex-wrap gap-3">
                  {selectedType.locations.map((loc) => (
                    <OptionPill
                      key={loc}
                      active={location === loc}
                      onClick={() => setLocation(loc)}
                    >
                      {LOCATION_LABELS[loc] ?? loc}
                    </OptionPill>
                  ))}
                </div>
              </div>
            )}

            {selectedType.staff.length > 1 && (
              <div>
                <h2 className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4 pb-2 border-b border-border">
                  With whom
                </h2>
                <div className="flex flex-wrap gap-3">
                  {selectedType.staff.map((person) => (
                    <OptionPill
                      key={person}
                      active={staff === person}
                      onClick={() => setStaff(person)}
                    >
                      {person}
                    </OptionPill>
                  ))}
                  <OptionPill
                    active={staff === NO_PREFERENCE}
                    onClick={() => setStaff(NO_PREFERENCE)}
                  >
                    No preference
                  </OptionPill>
                </div>
              </div>
            )}

            <Button
              type="button"
              disabled={!location || !staff}
              onClick={() => setStep(2)}
              className="bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-5 rounded-full tracking-widest uppercase text-xs disabled:opacity-50"
            >
              Continue
            </Button>
          </section>
        )}

        {/* Step 2 — Time */}
        {step === 2 && selectedType && (
          <section data-testid="step-time">
            <p className="text-xs text-muted-foreground mb-6">
              Times shown in {timezone.replace(/_/g, " ")}.
            </p>

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
                soon or reach out through our contact page.
              </p>
            )}

            {availableDates.length > 0 && (
              <>
                <div className="flex gap-2 overflow-x-auto pb-3 mb-6">
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
                      onClick={() => chooseSlot(iso)}
                      data-testid={`slot-${iso}`}
                      className="py-2.5 rounded-lg border border-border text-sm text-foreground hover:border-primary hover:bg-primary/10 hover:text-primary transition-all"
                    >
                      {fmtTime(iso, timezone)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {/* Step 3 — Your details */}
        {step === 3 && selectedType && selectedSlot && (
          <section data-testid="step-details">
            <div className="border border-border rounded-lg p-5 mb-8 bg-muted/20 space-y-1.5">
              <p className="text-sm">
                <span className="text-muted-foreground">Appointment:</span>{" "}
                {selectedType.name}
                {staffParam ? ` with ${staffParam}` : ""}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">When:</span>{" "}
                {fmtWhen(selectedSlot, timezone)}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Where:</span>{" "}
                {location ? (LOCATION_LABELS[location] ?? location) : ""}
              </p>
            </div>

            <form
              onSubmit={handleSubmit(onSubmitDetails)}
              className="space-y-6"
            >
              <div>
                <Label
                  htmlFor="fullName"
                  className="text-sm font-light tracking-wide"
                >
                  Full Name <span className="text-primary">*</span>
                </Label>
                <Input
                  id="fullName"
                  {...register("fullName")}
                  placeholder="Your full name"
                  className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none"
                />
                {errors.fullName && (
                  <p className="text-destructive text-xs mt-1">
                    {errors.fullName.message}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <Label
                    htmlFor="email"
                    className="text-sm font-light tracking-wide"
                  >
                    Email <span className="text-primary">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    {...register("email")}
                    placeholder="you@example.com"
                    className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none"
                  />
                  {errors.email && (
                    <p className="text-destructive text-xs mt-1">
                      {errors.email.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label
                    htmlFor="phone"
                    className="text-sm font-light tracking-wide"
                  >
                    Phone
                    <span className="text-muted-foreground/60 ml-1 text-xs">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="phone"
                    type="tel"
                    {...register("phone")}
                    placeholder="+1 (555) 000-0000"
                    className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none"
                  />
                </div>
              </div>

              <div>
                <Label className="text-sm font-light tracking-wide">
                  Preferred Contact Method
                  <span className="text-muted-foreground/60 ml-1 text-xs">
                    (optional)
                  </span>
                </Label>
                <div className="flex gap-3 mt-2">
                  {(["email", "phone", "text"] as const).map((method) => (
                    <OptionPill
                      key={method}
                      active={preferredContact === method}
                      onClick={() =>
                        setValue("preferredContact", method, {
                          shouldValidate: true,
                        })
                      }
                    >
                      {method}
                    </OptionPill>
                  ))}
                </div>
              </div>

              <div>
                <Label
                  htmlFor="notes"
                  className="text-sm font-light tracking-wide"
                >
                  Anything we should know?
                  <span className="text-muted-foreground/60 ml-1 text-xs">
                    (optional)
                  </span>
                </Label>
                <Textarea
                  id="notes"
                  {...register("notes")}
                  placeholder="Share anything that would help us prepare."
                  rows={4}
                  className="mt-1.5 bg-transparent border border-border rounded-lg px-3 py-2 text-sm focus-visible:ring-0 focus-visible:border-primary transition-colors resize-none shadow-none"
                />
              </div>

              <div className="flex justify-center pt-2">
                <Button
                  type="submit"
                  disabled={createAppointment.isPending}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 px-10 py-6 rounded-full tracking-widest uppercase text-xs transition-all duration-300 hover:shadow-[0_0_20px_rgba(209,156,151,0.2)] disabled:opacity-50"
                >
                  {createAppointment.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Booking…
                    </>
                  ) : (
                    "Confirm Booking"
                  )}
                </Button>
              </div>
            </form>
          </section>
        )}
      </div>
    </PageShell>
  );
}
