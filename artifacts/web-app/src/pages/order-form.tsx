import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useSearch } from "wouter";
import {
  useCreateOrder,
  useGetCapacity,
  useGetColors,
  useGetServices,
  useSubscribeNewsletter,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ctaVariants, CtaLink } from "@/components/cta";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageShell } from "@/components/page-shell";
import { ReferenceImageUpload } from "@/components/reference-image-upload";
import { ColorPicker } from "@/components/color-picker";
import { WaitlistForm } from "@/components/waitlist-form";
import { SuccessScreen } from "@/components/success-screen";
import { Seo } from "@/components/seo";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { isRushNeededBy, RUSH_SURCHARGE_NOTE } from "@/lib/rush";
import {
  requestedServiceId,
  serviceRules,
  SERVICE_FALLBACK,
  type ServiceRules,
} from "@/lib/order-services";
import { useAnalytics, AnalyticsEvent } from "@/lib/analytics";
import { useSubmitTimer } from "@/lib/anti-spam";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  Check,
  CheckCircle,
  Loader2,
  Zap,
} from "lucide-react";

const MEASUREMENT_FIELDS = [
  { key: "waist", label: "Waist" },
  // The contract field stays `bust`; only the visible label is neutral.
  { key: "bust", label: "Chest" },
  { key: "hips", label: "Hips" },
  { key: "height", label: "Height" },
  { key: "bodyGirth", label: "Body Girth" },
] as const;

// The intake is a three-step flow, so no one page carries the whole form: which
// service they want and who they are, then the piece itself, then when they need
// it. Step 0 carries every required field; step 1 is optional for a bespoke
// commission and carries the brief for the services worked on a piece the
// customer already owns; the order is placed from step 2.
const STEPS = ["Your details", "Your piece", "Timeline"] as const;

// Which fields live on which step. Two things read this: advancing validates
// only the step being left (so an error further on can't block it), and a
// failed final submit jumps back to the earliest step that owns an error
// instead of stranding the customer on a page with nothing marked. Keep it in
// step with the sections rendered below.
const STEP_FIELDS = [
  [
    "service",
    "fullName",
    "email",
    "phone",
    "preferredContact",
    "measurementMode",
    "measurementUnit",
    "waist",
    "bust",
    "hips",
    "height",
    "bodyGirth",
  ],
  ["colors", "colorUsage", "description"],
  ["neededBy", "rushAcknowledged", "referralCode", "subscribeNewsletter"],
] as const satisfies readonly (readonly (keyof FormInput)[])[];

// Form-friendly schema (string inputs, friendly messages). Its output is mapped
// to the generated `NewOrderRequest` contract where it is handed to the
// `useCreateOrder` mutation below, so the form cannot silently drift from the
// API spec.
//
// It is built per service rather than declared once, because which fields are
// required depends on which service the customer picked — measurements only for
// a garment made from scratch, the free-text brief only for work on a piece they
// already own. A flat field schema can't express that, so the rules come in as
// `rules` and the superRefine applies them; the same rules are what the server's
// `enforceServiceGate` checks, both from the one `GET /services` catalog. The
// resolver is rebuilt when the picked service changes (see `useMemo` below).
function buildFormSchema(rules: ServiceRules) {
  return z
    .object({
      // The chosen service's id. Required only once the catalog has loaded — with
      // no catalog there is no picker to answer, and the server reads an absent
      // service as a bespoke commission.
      service: z.string().default(""),
      fullName: z.string().min(1, "Full name is required"),
      email: z.string().email("Please enter a valid email address"),
      phone: z.string().min(1, "Phone number is required"),
      preferredContact: z.enum(["email", "phone", "text"], {
        required_error: "Please select a preferred contact method",
      }),
      measurementMode: z.enum(["self", "appointment"]).default("self"),
      measurementUnit: z.enum(["inches", "cm"]).default("inches"),
      waist: z.string().optional(),
      bust: z.string().optional(),
      hips: z.string().optional(),
      height: z.string().optional(),
      bodyGirth: z.string().optional(),
      description: z.string().optional(),
      // The colors the customer picked from the studio palette (multi-select,
      // driven by <ColorPicker/> via setValue) + a free-text note on how they'd
      // like them used. Both optional — exact fabric is settled at consultation.
      colors: z.array(z.string()).default([]),
      colorUsage: z.string().optional(),
      neededBy: z.string().optional(),
      // Optional referral code from another skater. Validated server-side against
      // the CRM (an unknown/self code is silently ignored), so no client checks.
      referralCode: z.string().optional(),
      // Set when the customer acknowledges the rush surcharge. Only *required*
      // when the needed-by date lands inside the rush window (see superRefine).
      rushAcknowledged: z.boolean().default(false),
      // Marketing opt-in, separate from the transactional order. Off by default —
      // consent must be a deliberate tick.
      subscribeNewsletter: z.boolean().default(false),
    })
    .superRefine((values, ctx) => {
      if (rules.required && !values.service) {
        ctx.addIssue({
          path: ["service"],
          code: z.ZodIssueCode.custom,
          message: "Please choose the service you'd like",
        });
      }

      // For alterations, rhinestoning and repairs the free-text field is the
      // brief — what the piece is and what needs doing — so it is required. A
      // bespoke commission's design notes stay optional (the design is settled at
      // consultation), which is exactly the split the server enforces.
      if (rules.detailsRequired && !values.description?.trim()) {
        ctx.addIssue({
          path: ["description"],
          code: z.ZodIssueCode.custom,
          message: "Please tell us about the piece and what you'd like done",
        });
      }

      // "Needed by", when supplied, must be in the future — it feeds the atelier's
      // real scheduling (the order's Due Date), so a past date is a mistake.
      if (values.neededBy) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const chosen = new Date(`${values.neededBy}T00:00:00`);
        if (!Number.isNaN(chosen.getTime()) && chosen < today) {
          ctx.addIssue({
            path: ["neededBy"],
            code: z.ZodIssueCode.custom,
            message: "Please choose a date in the future",
          });
        }
      }

      // A needed-by date inside the rush window carries a surcharge; the customer
      // must acknowledge it before the order can be placed.
      if (isRushNeededBy(values.neededBy) && !values.rushAcknowledged) {
        ctx.addIssue({
          path: ["rushAcknowledged"],
          code: z.ZodIssueCode.custom,
          message: "Please acknowledge the rush surcharge to continue",
        });
      }

      // A service that doesn't ask for body measurements never renders the inputs,
      // so it must not require them either.
      if (!rules.measurements) return;
      if (values.measurementMode !== "self") return;
      for (const { key } of MEASUREMENT_FIELDS) {
        const raw = values[key];
        const num = Number(raw);
        if (!raw || Number.isNaN(num) || num <= 0) {
          ctx.addIssue({
            path: [key],
            code: z.ZodIssueCode.custom,
            message:
              raw && !Number.isNaN(num)
                ? "Must be a positive number"
                : "Required",
          });
        }
      }
    });
}

// The field *shape* is the same for every service — only which fields the
// refinement requires differs — so one built schema stands in for the types.
const BASE_SCHEMA = buildFormSchema(SERVICE_FALLBACK);
type FormInput = z.input<typeof BASE_SCHEMA>;
type FormValues = z.output<typeof BASE_SCHEMA>;

export default function OrderForm() {
  const [success, setSuccess] = useState<{
    orderNumber: string;
    appointment: boolean;
  } | null>(null);
  // Notion file_upload ids for reference images the customer uploaded (managed
  // by <ReferenceImageUpload/>, which uploads each as it's chosen).
  const [referenceImageIds, setReferenceImageIds] = useState<string[]>([]);
  // Which step of the three-step flow is showing (0 = details, 1 = design,
  // 2 = timeline).
  const [step, setStep] = useState(0);
  // Set when the server refuses an order because the books closed (409) — a
  // stale tab, or capacity reached while the customer was filling the form in.
  // Showing them the waitlist is the honest recovery; a toast saying "we're
  // full" with the form still in front of them is not.
  const [refusedForCapacity, setRefusedForCapacity] = useState(false);
  const { toast } = useToast();

  const createOrder = useCreateOrder({
    mutation: {
      onSuccess: (data, variables) =>
        setSuccess({
          orderNumber: data.orderNumber,
          appointment: variables.data.measurementAppointment === true,
        }),
      onError: (error) => {
        const message =
          error.data?.error ||
          error.message ||
          "Something went wrong. Please try again.";
        if (error.status === 409) {
          setRefusedForCapacity(true);
          return;
        }
        toast({
          variant: "destructive",
          title: "Submission failed",
          description: message,
        });
      },
    },
  });

  // Best-effort marketing opt-in, fired alongside the order when the customer
  // ticks the box. Independent of the order write: a failure here is swallowed
  // (the server flow is best-effort too) and never blocks the order confirmation.
  const subscribeNewsletter = useSubscribeNewsletter();
  const newsletterElapsedMs = useSubmitTimer();

  const analytics = useAnalytics();
  // Funnel-start fires once, on the customer's first interaction with the form.
  const formStarted = useRef(false);
  const onFormStart = () => {
    if (formStarted.current) return;
    formStarted.current = true;
    analytics(AnalyticsEvent.OrderFormStart);
  };

  // The studio's color palette (a built-in primary set, atelier-overridable via
  // the COLOR_PALETTE Studio Settings value). Best-effort: if the fetch errors,
  // the chips just don't render and the customer still describes what they want
  // in the usage note — it never blocks the order form.
  const { data: colorsData } = useGetColors();
  const palette = colorsData?.colors ?? [];

  // The studio's service catalog — which services can be ordered and, per
  // service, what the rest of this form asks for. Served rather than duplicated
  // here so the form and the server's `POST /orders` gate work off one
  // definition. Degrade-safe like the palette: while it loads or if it errors
  // the list is empty, the picker doesn't render, and the form falls back to the
  // bespoke commission's shape — which is exactly what it asked for before
  // services existed, and what the server reads an order with no service as.
  const { data: servicesData } = useGetServices();
  const services = servicesData?.services ?? [];

  // Whether the studio is taking bespoke commissions, and the competitions a
  // waitlist entry can be pinned to. The same decision gates `POST /orders`, so
  // this is asking the server rather than deciding anything here.
  //
  // Degrade-safe in the direction that keeps the form usable: while the query
  // is in flight, or if it errors, `capacityData` is undefined and the intake
  // form renders as it always has. A closed door is only ever drawn on a
  // definite answer — the server still refuses the submit, and the 409 above
  // brings the customer to the same waitlist.
  const { data: capacityData } = useGetCapacity();

  // The resolver is indirected through a ref so that changing service
  // re-validates against the new service's rules without re-creating the form,
  // which would drop every value the customer has already entered. Its current
  // value is set from `rules` just below, once `watch` exists to read the pick.
  const resolverRef = useRef(zodResolver(BASE_SCHEMA));

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    trigger,
    formState: { errors },
  } = useForm<FormInput, any, FormValues>({
    resolver: (values, context, options) =>
      resolverRef.current(values, context, options),
    defaultValues: {
      service: "",
      measurementMode: "self",
      measurementUnit: "inches",
      preferredContact: undefined,
      colors: [],
    },
  });

  const submitting = createOrder.isPending;
  const pickedService = watch("service");
  // What the chosen service asks for. Everything below — which sections render,
  // which fields validate, and what goes in the payload — reads this one value.
  const rules = useMemo(
    () => serviceRules(services, pickedService),
    [services, pickedService],
  );
  resolverRef.current = useMemo(
    () => zodResolver(buildFormSchema(rules)),
    [rules],
  );

  // The books are closed to THIS customer when the studio says they're closed
  // and the service they picked is one that consumes making capacity. A repair
  // is unaffected, which is why this is a per-service test rather than a flag
  // on the page.
  const booksClosed =
    refusedForCapacity || (capacityData?.open === false && rules.capacityGated);

  // Deep-link: `/order?service=<id>` (the per-service links on the Services
  // page) preselects that service once the catalog has loaded, mirroring
  // `/appointments?type=<id>`. Runs once — the ref guard leaves a customer who
  // then picks something else alone. An unknown id resolves to undefined and
  // simply leaves them on the picker.
  const search = useSearch();
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || services.length === 0) return;
    const requested = requestedServiceId(search, services);
    if (!requested) return;
    preselected.current = true;
    setValue("service", requested);
  }, [search, services, setValue]);
  const measurementMode = watch("measurementMode");
  const measurementUnit = watch("measurementUnit");
  const preferredContact = watch("preferredContact");
  const colors = watch("colors") ?? [];
  // A needed-by date inside the rush window surfaces the surcharge disclosure
  // and requires an acknowledgement before the order can be placed.
  const neededByValue = watch("neededBy");
  const isRush = isRushNeededBy(neededByValue);
  // Floor the "needed by" picker at today, so a past date can't be picked.
  const todayIso = new Date().toISOString().split("T")[0];

  // Advance a step only once the step being left validates. Validation is
  // scoped to that step's own fields, so an unfinished later step (an
  // unacknowledged rush surcharge on step 2, say) can't block step 0.
  const goToNextStep = async () => {
    if (await trigger(STEP_FIELDS[step])) setStep((current) => current + 1);
  };

  // A failed submit sends the customer to the earliest step that owns an
  // error, so the messages they're told about are on the page they land on.
  const onInvalid = (formErrors: FieldErrors<FormInput>) => {
    const firstBadStep = STEP_FIELDS.findIndex((fields) =>
      fields.some((field) => formErrors[field]),
    );
    if (firstBadStep >= 0) setStep(firstBadStep);
  };

  const onSubmit = (values: FormValues) => {
    const {
      service,
      description,
      neededBy,
      referralCode,
      measurementMode,
      measurementUnit,
      rushAcknowledged: _rushAcknowledged,
      subscribeNewsletter: optIn,
      waist,
      bust,
      hips,
      height,
      bodyGirth,
      colors: pickedColors,
      colorUsage,
      ...contact
    } = values;

    // A rush order is derived from the needed-by date (the superRefine above
    // guarantees the surcharge was acknowledged when this is true).
    const rush = isRushNeededBy(neededBy);

    // Funnel-submit: non-identifying shape of the order only (no name/email/
    // phone/measurements). Fired client-side before the network call.
    analytics(AnalyticsEvent.OrderFormSubmit, {
      // Which service was ordered — the one field that says whether the funnel
      // is carrying commissions or standalone work. Non-identifying, like the
      // rest of this payload.
      service: service || "unspecified",
      rush,
      measurementMode,
      hasReferral: Boolean(referralCode?.trim()),
      hasReferenceImages: referenceImageIds.length > 0,
      subscribeNewsletter: Boolean(optIn),
    });

    // Opt-in rides alongside the order rather than through it: a separate,
    // best-effort call keyed to the same email, so the order contract stays
    // unchanged and the marketing capture lives in one place.
    if (optIn) {
      subscribeNewsletter.mutate({
        data: {
          email: contact.email,
          source: "order form",
          elapsedMs: newsletterElapsedMs(),
        },
      });
    }

    // Either supply the measurements, or flag that they'll be taken at an
    // appointment — never both. (The superRefine above guarantees the "self"
    // branch has all five present.) A service that never asked for measurements
    // sends neither: its inputs were never rendered, so their values would be
    // empty strings, and the server doesn't require them for that service.
    const measurements = !rules.measurements
      ? {}
      : measurementMode === "appointment"
        ? { measurementAppointment: true }
        : {
            measurementUnit,
            waist: Number(waist),
            bust: Number(bust),
            hips: Number(hips),
            height: Number(height),
            bodyGirth: Number(bodyGirth),
          };

    // Omit empty optional fields so the server never receives an empty date
    // string (which would fail its date coercion).
    createOrder.mutate({
      data: {
        ...contact,
        ...(service ? { service } : {}),
        ...measurements,
        ...(description ? { description } : {}),
        ...(neededBy ? { neededBy } : {}),
        ...(rush ? { rush: true } : {}),
        ...(referralCode?.trim() ? { referralCode: referralCode.trim() } : {}),
        ...(referenceImageIds.length ? { referenceImageIds } : {}),
        // Dropped for a service that doesn't offer the palette — a customer who
        // picked colours and then switched to a repair must not have them ride
        // along on a form that stopped showing them.
        ...(rules.colors && pickedColors.length
          ? { colors: pickedColors }
          : {}),
        ...(rules.colors && colorUsage ? { colorUsage } : {}),
      },
    });
  };

  if (success) {
    return (
      <SuccessScreen
        icon={CheckCircle}
        title="Order Received"
        description={
          success.appointment
            ? "Thank you! We'll be in touch soon to schedule your measurement appointment and confirm your details. You can also schedule a consultation now to talk through your design."
            : "Thank you! We'll be in touch soon to confirm your details. Want to talk it through? Schedule a consultation now."
        }
        footer={
          <div className="flex flex-col items-center gap-6">
            <div className="flex flex-col sm:flex-row items-center gap-3">
              {success.appointment && (
                <CtaLink
                  to="/appointments?type=fitting"
                  variant="primary"
                  data-testid="link-book-fitting-success"
                >
                  <CalendarCheck className="w-4 h-4" />
                  Book your fitting
                </CtaLink>
              )}
              {/* A consultation to talk through the piece is offered on every
                  order confirmation; when a fitting is also on offer it steps
                  down to the secondary (outline) action. */}
              <CtaLink
                to="/appointments?type=consultation"
                variant={success.appointment ? "outline" : "primary"}
                data-testid="link-book-consultation-success"
              >
                <CalendarCheck className="w-4 h-4" />
                Schedule a consultation
              </CtaLink>
            </div>
            <Link
              to="/track"
              className="inline-flex items-center gap-2 text-sm tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
              data-testid="link-track-order"
            >
              <ArrowLeft className="w-4 h-4" />
              Track order status
            </Link>
          </div>
        }
      >
        <div className="border border-border rounded-lg p-6 mb-8 inline-block">
          <p className="text-xs tracking-[0.15em] uppercase text-muted-foreground mb-1">
            Your order number
          </p>
          <p
            className="text-2xl font-mono font-medium text-primary tracking-widest"
            data-testid="order-number"
          >
            {success.orderNumber}
          </p>
        </div>
        <p className="text-sm text-muted-foreground mb-8">
          Save this number so you can track your order status at any time.
        </p>
      </SuccessScreen>
    );
  }

  // The service picker, hoisted out of step 0 because the closed-books
  // branch below renders it too: a customer sent to the waitlist has to be
  // able to switch to a repair, which is still open, without going back.
  const servicePicker = (
    <>
      {/* The service comes first: it decides what the rest of the form
        asks for. Hidden entirely when the catalog couldn't be read,
        in which case the form falls back to the bespoke shape rather
        than blocking behind a choice it can't offer. */}
      {services.length > 0 && (
        <section>
          <h2 className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-6 pb-2 border-b border-border">
            What can we make for you?
          </h2>
          <div
            className="grid sm:grid-cols-2 gap-3"
            data-testid="service-picker"
          >
            {services.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() =>
                  setValue("service", option.id, {
                    shouldValidate: true,
                  })
                }
                aria-pressed={pickedService === option.id}
                data-testid={`service-option-${option.id}`}
                className={`text-left px-4 py-3 rounded-lg border transition-all ${
                  pickedService === option.id
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <span
                  className={`block text-sm tracking-wide ${
                    pickedService === option.id
                      ? "text-primary"
                      : "text-foreground"
                  }`}
                >
                  {option.name}
                </span>
                <span className="block text-xs font-light text-muted-foreground mt-1 leading-relaxed">
                  {option.summary}
                </span>
              </button>
            ))}
          </div>
          {errors.service && (
            <p className="text-destructive text-xs mt-2">
              {errors.service.message}
            </p>
          )}
        </section>
      )}
    </>
  );

  // The studio's books are closed for the service this customer picked, so the
  // waitlist takes the intake form's place. The header and the service picker
  // stay: the three services worked on a piece the customer already owns are
  // unaffected, and switching to one has to be a click rather than a back
  // button.
  if (booksClosed) {
    return (
      <PageShell align="top" noise={false}>
        <Seo {...ROUTE_SEO["/order"]} />
        <div className="max-w-2xl mx-auto px-6 pt-24 pb-20">
          <div className="mb-10">
            <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-3">
              Join the Waitlist
            </h1>
            <p className="text-muted-foreground font-light text-lg">
              We&rsquo;re not taking new commissions just now. Leave us your
              details and we&rsquo;ll come to you first when we are.
            </p>
          </div>

          <div className="space-y-12">
            {servicePicker}
            <WaitlistForm
              // The atelier's own wording when the server sent it. The 409 path
              // has no capacity payload to read, so it falls back to the same
              // sentence the server's default message carries.
              message={
                capacityData?.message ||
                "Our books are full for the current season. Join the waitlist and we'll be in touch the moment a space opens up."
              }
            />
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell align="top" noise={false}>
      <Seo {...ROUTE_SEO["/order"]} />
      <div className="max-w-2xl mx-auto px-6 pt-24 pb-20">
        <div className="mb-10">
          <Link
            to="/track"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors tracking-widest uppercase mb-8 group"
            data-testid="link-track-my-order"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Track my order
          </Link>
          <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-3">
            Place an Order
          </h1>
          <p className="text-muted-foreground font-light text-lg">
            Tell us what you&rsquo;d like made or mended, and we&rsquo;ll take
            it from there.
          </p>
        </div>

        {/* noValidate: zod owns validation (incl. the needed-by floor), so the
            browser's native constraint bubble can't pre-empt our inline
            messages. On every step but the last, a submit (button or Enter)
            advances after validating that step; on the last it places the
            order. */}
        <form
          noValidate
          onSubmit={
            step < STEPS.length - 1
              ? (e) => {
                  e.preventDefault();
                  void goToNextStep();
                }
              : handleSubmit(onSubmit, onInvalid)
          }
          onFocusCapture={onFormStart}
          onChangeCapture={onFormStart}
          className="space-y-12"
        >
          {/* Step indicator */}
          <ol className="flex items-center gap-2 text-[11px] tracking-[0.15em] uppercase">
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

          {step === 0 && (
            <div className="space-y-12">
              {servicePicker}

              <section>
                <h2 className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-6 pb-2 border-b border-border">
                  Contact Information
                </h2>
                <div className="space-y-5">
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
                        Phone Number <span className="text-primary">*</span>
                      </Label>
                      <Input
                        id="phone"
                        type="tel"
                        {...register("phone")}
                        placeholder="+1 (555) 000-0000"
                        className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none"
                      />
                      {errors.phone && (
                        <p className="text-destructive text-xs mt-1">
                          {errors.phone.message}
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-light tracking-wide">
                      Preferred Contact Method{" "}
                      <span className="text-primary">*</span>
                    </Label>
                    <div className="flex gap-3 mt-2">
                      {(["email", "phone", "text"] as const).map((method) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() =>
                            setValue("preferredContact", method, {
                              shouldValidate: true,
                            })
                          }
                          className={`px-4 py-2 rounded-full text-xs tracking-widest uppercase border transition-all ${
                            preferredContact === method
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          {method.charAt(0).toUpperCase() + method.slice(1)}
                        </button>
                      ))}
                    </div>
                    {errors.preferredContact && (
                      <p className="text-destructive text-xs mt-1">
                        {errors.preferredContact.message}
                      </p>
                    )}
                  </div>
                </div>
              </section>

              {/* Only a garment made from scratch needs body measurements; an
                  alteration, a stoning job or a repair is measured on the piece
                  itself, in person. The server skips the same check for those
                  services, from the same catalog entry. */}
              {rules.measurements && (
                <section>
                  <div className="flex items-center justify-between mb-6 pb-2 border-b border-border">
                    <h2 className="text-xs tracking-[0.2em] uppercase text-muted-foreground">
                      Measurements
                    </h2>
                    {measurementMode === "self" && (
                      <div className="flex gap-2">
                        {(["inches", "cm"] as const).map((unit) => (
                          <button
                            key={unit}
                            type="button"
                            onClick={() => setValue("measurementUnit", unit)}
                            className={`px-3 py-1 rounded-full text-xs tracking-wider border transition-all ${
                              measurementUnit === unit
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:border-primary/50"
                            }`}
                          >
                            {unit}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 mb-8">
                    {(
                      [
                        { mode: "self", label: "I'll enter my measurements" },
                        {
                          mode: "appointment",
                          label: "Take them at an appointment",
                        },
                      ] as const
                    ).map(({ mode, label }) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() =>
                          setValue("measurementMode", mode, {
                            shouldValidate: true,
                          })
                        }
                        className={`flex-1 px-4 py-3 rounded-lg text-sm tracking-wide border transition-all ${
                          measurementMode === mode
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {measurementMode === "self" ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
                      {MEASUREMENT_FIELDS.map(({ key, label }) => (
                        <div key={key}>
                          <Label
                            htmlFor={key}
                            className="text-sm font-light tracking-wide"
                          >
                            {label}
                            <span className="text-muted-foreground/60 ml-1 text-xs">
                              ({measurementUnit})
                            </span>
                          </Label>
                          <Input
                            id={key}
                            type="number"
                            step="0.1"
                            min="0"
                            {...register(key)}
                            placeholder="0.0"
                            className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none"
                          />
                          {errors[key] && (
                            <p className="text-destructive text-xs mt-1">
                              {errors[key]?.message}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="border border-border rounded-lg p-6 bg-muted/20">
                      {/* Deliberately no "book your fitting" link here: a
                          fitting is booked against an order number, which the
                          customer doesn't have until this form is submitted.
                          Offering it mid-form sent people away before they had
                          one. The confirmation screen offers it instead. */}
                      <p className="text-sm font-light text-foreground/90 leading-relaxed">
                        No problem, we'll take your measurements for you. Finish
                        placing your order and we'll arrange a fitting to take
                        them — you'll be able to book it as soon as your order
                        is confirmed.
                      </p>
                    </div>
                  )}
                </section>
              )}

              <div className="flex justify-center pt-4 pb-8">
                <Button
                  type="submit"
                  className={ctaVariants({ variant: "primary", size: "lg" })}
                  data-testid="continue-to-design"
                >
                  Continue to your piece
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-12">
              <button
                type="button"
                onClick={() => setStep(0)}
                className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors tracking-widest uppercase group"
                data-testid="button-back-to-details"
              >
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                Back to your details
              </button>

              {/* The palette is offered where a colour choice is actually ours
                  to make — a commission we're designing, or the stones going on
                  a piece. An alteration or a repair works with what the garment
                  already is. */}
              {rules.colors && (
                <section>
                  <h2 className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-2 pb-2 border-b border-border">
                    Colors
                  </h2>
                  <p className="text-muted-foreground font-light text-sm mb-6">
                    Optional. Pick the colors you're picturing (choose as many
                    as you like), or skip this and we'll settle it together at
                    your consultation.
                  </p>
                  <div className="space-y-6">
                    <ColorPicker
                      palette={palette}
                      value={colors}
                      onChange={(next) =>
                        setValue("colors", next, { shouldValidate: false })
                      }
                      disabled={submitting}
                    />

                    <div>
                      <Label
                        htmlFor="colorUsage"
                        className="text-sm font-light tracking-wide"
                      >
                        How would you like these colors used?
                        <span className="text-muted-foreground/60 ml-1 text-xs">
                          (optional)
                        </span>
                      </Label>
                      <Textarea
                        id="colorUsage"
                        {...register("colorUsage")}
                        placeholder="e.g. emerald as the main color with gold accents on the collar, and a blush skirt."
                        rows={3}
                        className="mt-1.5 bg-transparent border border-border rounded-lg px-3 py-2 text-sm focus-visible:ring-0 focus-visible:border-primary transition-colors resize-none shadow-none"
                      />
                    </div>
                  </div>
                </section>
              )}

              <section>
                <h2 className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-6 pb-2 border-b border-border">
                  Costume Details
                </h2>
                <div className="space-y-6">
                  <div>
                    {/* Label, prompt and whether it's required all come from the
                        service: for a commission these are optional design
                        notes, for a repair it is the brief. */}
                    <Label
                      htmlFor="description"
                      className="text-sm font-light tracking-wide"
                    >
                      {rules.detailsLabel}
                      {rules.detailsRequired ? (
                        <span className="text-primary"> *</span>
                      ) : (
                        <span className="text-muted-foreground/60 ml-1 text-xs">
                          (optional)
                        </span>
                      )}
                    </Label>
                    <Textarea
                      id="description"
                      {...register("description")}
                      placeholder={rules.detailsHelp}
                      rows={4}
                      className="mt-1.5 bg-transparent border border-border rounded-lg px-3 py-2 text-sm focus-visible:ring-0 focus-visible:border-primary transition-colors resize-none shadow-none"
                    />
                    {errors.description && (
                      <p className="text-destructive text-xs mt-1">
                        {errors.description.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <Label className="text-sm font-light tracking-wide">
                      Reference Images
                      <span className="text-muted-foreground/60 ml-1 text-xs">
                        (optional)
                      </span>
                    </Label>
                    <div className="mt-2">
                      <ReferenceImageUpload
                        onChange={setReferenceImageIds}
                        disabled={submitting}
                        helpText="Inspiration photos, fabric swatches, or a custom print you'd like us to work from."
                      />
                    </div>
                  </div>
                </div>
              </section>

              <div className="flex justify-center pt-4 pb-8">
                <Button
                  type="submit"
                  className={ctaVariants({ variant: "primary", size: "lg" })}
                  data-testid="continue-to-timeline"
                >
                  Continue to timeline
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-10">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors tracking-widest uppercase group"
                data-testid="button-back-to-design"
              >
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                Back to your piece
              </button>

              <section>
                <h2 className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-2 pb-2 border-b border-border">
                  Timeline
                </h2>
                <p className="text-muted-foreground font-light text-sm mb-6">
                  Last step, and all of it is optional.
                </p>
                <div className="space-y-6">
                  <div>
                    <Label
                      htmlFor="neededBy"
                      className="text-sm font-light tracking-wide"
                    >
                      Needed By
                      <span className="text-muted-foreground/60 ml-1 text-xs">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      id="neededBy"
                      type="date"
                      min={todayIso}
                      {...register("neededBy")}
                      className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none w-48"
                    />
                    {errors.neededBy ? (
                      <p className="text-destructive text-xs mt-1">
                        {errors.neededBy.message}
                      </p>
                    ) : (
                      <p className="text-muted-foreground/60 text-xs mt-1.5">
                        Custom pieces typically take 4-8 weeks. If you have an
                        event date, let us know and we'll advise on timing.
                      </p>
                    )}
                  </div>

                  {isRush && (
                    <div
                      className="border border-primary/40 bg-primary/5 rounded-lg p-5"
                      data-testid="rush-notice"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-4 h-4 text-primary" />
                        <p className="text-sm tracking-wide text-foreground font-medium">
                          Rush order
                        </p>
                      </div>
                      <p className="text-sm font-light text-muted-foreground leading-relaxed mb-4">
                        Your date is sooner than our standard timeline, so this
                        is a rush order. Rush pieces carry {RUSH_SURCHARGE_NOTE}
                        . We'll confirm we can meet your date before any work
                        begins.
                      </p>
                      <label
                        htmlFor="rushAcknowledged"
                        className="flex items-start gap-3 cursor-pointer group"
                      >
                        <input
                          id="rushAcknowledged"
                          type="checkbox"
                          {...register("rushAcknowledged")}
                          data-testid="rush-acknowledge"
                          className="mt-1 h-4 w-4 shrink-0 rounded-sm border-border text-primary accent-primary focus-visible:ring-primary"
                        />
                        <span className="text-sm font-light text-foreground/90 group-hover:text-foreground transition-colors">
                          I understand a rush surcharge applies to my order.
                        </span>
                      </label>
                      {errors.rushAcknowledged && (
                        <p className="text-destructive text-xs mt-2">
                          {errors.rushAcknowledged.message}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section>
                <h2 className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-6 pb-2 border-b border-border">
                  Referral
                </h2>
                <div>
                  <Label
                    htmlFor="referralCode"
                    className="text-sm font-light tracking-wide"
                  >
                    Referral Code
                    <span className="text-muted-foreground/60 ml-1 text-xs">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="referralCode"
                    {...register("referralCode")}
                    placeholder="e.g. AA-XXXXXX"
                    data-testid="input-referral-code"
                    className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none w-64"
                  />
                  <p className="text-muted-foreground/60 text-xs mt-1.5">
                    Referred by a friend? Enter their code and we'll send you a
                    welcome discount.
                  </p>
                </div>
              </section>

              <label
                htmlFor="subscribeNewsletter"
                className="flex items-start gap-3 max-w-md mx-auto cursor-pointer group"
              >
                <input
                  id="subscribeNewsletter"
                  type="checkbox"
                  {...register("subscribeNewsletter")}
                  data-testid="subscribe-newsletter"
                  className="mt-1 h-4 w-4 shrink-0 rounded-sm border-border text-primary accent-primary focus-visible:ring-primary"
                />
                <span className="text-sm font-light text-muted-foreground group-hover:text-foreground transition-colors">
                  Keep me posted with new collections and studio notes. You can
                  unsubscribe anytime.
                </span>
              </label>

              <p
                className="text-center text-xs font-light text-muted-foreground/70 max-w-md mx-auto"
                data-testid="deposit-note"
              >
                This starts your order. It isn't a payment. Once we've reviewed
                your details and quoted your piece, we'll send a deposit to
                reserve your place in the atelier's schedule.
              </p>

              <div className="flex justify-center pt-4 pb-8">
                <Button
                  type="submit"
                  disabled={submitting}
                  className={ctaVariants({ variant: "primary", size: "lg" })}
                  data-testid="submit-order"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Submit Order"
                  )}
                </Button>
              </div>
            </div>
          )}
        </form>
      </div>
    </PageShell>
  );
}
