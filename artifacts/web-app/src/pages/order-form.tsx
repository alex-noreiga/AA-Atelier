import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "wouter";
import { useCreateOrder } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ctaVariants } from "@/components/cta";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageShell } from "@/components/page-shell";
import { SuccessScreen } from "@/components/success-screen";
import {
  ReferenceUpload,
  type UploadedReference,
} from "@/components/reference-upload";
import { Seo } from "@/components/seo";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, CheckCircle, Loader2 } from "lucide-react";

const MEASUREMENT_FIELDS = [
  { key: "waist", label: "Waist" },
  { key: "bust", label: "Bust" },
  { key: "hips", label: "Hips" },
  { key: "height", label: "Height" },
  { key: "bodyGirth", label: "Body Girth" },
] as const;

// Form-friendly schema (string inputs, friendly messages). Its output is mapped
// to the generated `NewOrderRequest` contract where it is handed to the
// `useCreateOrder` mutation below, so the form cannot silently drift from the
// API spec.
//
// Measurements are optional: the customer either enters them now ("self"), or
// picks "appointment" to have them taken at a scheduled fitting/consultation.
// The measurement inputs are only *required* in "self" mode, which a flat field
// schema can't express — hence the superRefine.
const formSchema = z
  .object({
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
    neededBy: z.string().optional(),
  })
  .superRefine((values, ctx) => {
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

type FormValues = z.infer<typeof formSchema>;

export default function OrderForm() {
  const [success, setSuccess] = useState<{
    orderNumber: string;
    appointment: boolean;
  } | null>(null);
  const [references, setReferences] = useState<UploadedReference[]>([]);
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
        toast({
          variant: "destructive",
          title: "Submission failed",
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
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      measurementMode: "self",
      measurementUnit: "inches",
      preferredContact: undefined,
    },
  });

  const submitting = createOrder.isPending;
  const measurementMode = watch("measurementMode");
  const measurementUnit = watch("measurementUnit");
  const preferredContact = watch("preferredContact");

  const onSubmit = (values: FormValues) => {
    const {
      description,
      neededBy,
      measurementMode,
      measurementUnit,
      waist,
      bust,
      hips,
      height,
      bodyGirth,
      ...contact
    } = values;

    // Either supply the measurements, or flag that they'll be taken at an
    // appointment — never both. (The superRefine above guarantees the "self"
    // branch has all five present.)
    const measurements =
      measurementMode === "appointment"
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
        ...measurements,
        ...(description ? { description } : {}),
        ...(neededBy ? { neededBy } : {}),
        ...(references.length > 0
          ? { imageUrls: references.map((r) => r.url) }
          : {}),
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
            ? "Thank you! We'll be in touch soon to schedule your measurement appointment and confirm your details."
            : "Thank you! We'll be in touch soon to confirm your details."
        }
        footer={
          <Link
            to="/shop/status"
            className="inline-flex items-center gap-2 text-sm tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
            data-testid="link-track-order"
          >
            <ArrowLeft className="w-4 h-4" />
            Track order status
          </Link>
        }
      >
        <div className="border border-border rounded-lg p-6 mb-8 inline-block">
          <p className="text-xs tracking-[0.15em] uppercase text-muted-foreground mb-1">
            Your order number
          </p>
          <p className="text-2xl font-mono font-medium text-primary tracking-widest">
            {success.orderNumber}
          </p>
        </div>
        <p className="text-sm text-muted-foreground mb-8">
          Save this number — you can use it to track your order status at any
          time.
        </p>
      </SuccessScreen>
    );
  }

  return (
    <PageShell align="top" noise={false}>
      <Seo {...ROUTE_SEO["/order"]} />
      <div className="max-w-2xl mx-auto px-6 pt-24 pb-20">
        <div className="mb-10">
          <Link
            to="/shop/status"
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
            Tell us about your dream dress and we'll bring it to life.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-12">
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
                    setValue("measurementMode", mode, { shouldValidate: true })
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
                <p className="text-sm font-light text-foreground/90 leading-relaxed">
                  No problem — we'll take your measurements for you. Once you
                  place your order, we'll reach out to schedule a measurement
                  appointment, or take them during your consultation.
                </p>
              </div>
            )}
          </section>

          <section>
            <h2 className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-6 pb-2 border-b border-border">
              Dress Details
            </h2>
            <div className="space-y-6">
              <div>
                <Label
                  htmlFor="description"
                  className="text-sm font-light tracking-wide"
                >
                  Description / Notes
                  <span className="text-muted-foreground/60 ml-1 text-xs">
                    (optional)
                  </span>
                </Label>
                <Textarea
                  id="description"
                  {...register("description")}
                  placeholder="Tell us about your vision — style, fabric preferences, special requirements..."
                  rows={4}
                  className="mt-1.5 bg-transparent border border-border rounded-lg px-3 py-2 text-sm focus-visible:ring-0 focus-visible:border-primary transition-colors resize-none shadow-none"
                />
              </div>

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
                  {...register("neededBy")}
                  className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none w-48"
                />
              </div>

              <div>
                <Label className="text-sm font-light tracking-wide">
                  Reference Images / Video
                  <span className="text-muted-foreground/60 ml-1 text-xs">
                    (optional)
                  </span>
                </Label>
                <p className="text-xs text-muted-foreground/80 mt-1 mb-3">
                  Inspiration photos, sketches, or clips help us capture your
                  vision.
                </p>
                <ReferenceUpload
                  value={references}
                  onChange={setReferences}
                  disabled={submitting}
                />
              </div>
            </div>
          </section>

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
        </form>
      </div>
    </PageShell>
  );
}
