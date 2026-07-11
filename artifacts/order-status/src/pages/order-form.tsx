import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "wouter";
import { useCreateOrder } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageShell } from "@/components/page-shell";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, CheckCircle, Loader2 } from "lucide-react";

// Form-friendly schema (string inputs coerced to numbers, friendly messages).
// Its output shape is checked against the generated `NewOrderRequest` contract
// where it is handed to the `useCreateOrder` mutation below, so the form cannot
// silently drift from the API spec.
const formSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  email: z.string().email("Please enter a valid email address"),
  phone: z.string().min(1, "Phone number is required"),
  preferredContact: z.enum(["email", "phone", "text"], {
    required_error: "Please select a preferred contact method",
  }),
  measurementUnit: z.enum(["inches", "cm"]).default("inches"),
  waist: z.coerce.number({ invalid_type_error: "Required" }).positive("Must be a positive number"),
  bust: z.coerce.number({ invalid_type_error: "Required" }).positive("Must be a positive number"),
  hips: z.coerce.number({ invalid_type_error: "Required" }).positive("Must be a positive number"),
  height: z.coerce.number({ invalid_type_error: "Required" }).positive("Must be a positive number"),
  bodyGirth: z.coerce.number({ invalid_type_error: "Required" }).positive("Must be a positive number"),
  description: z.string().optional(),
  neededBy: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function OrderForm() {
  const [successOrderNumber, setSuccessOrderNumber] = useState<string | null>(null);
  const { toast } = useToast();

  const createOrder = useCreateOrder({
    mutation: {
      onSuccess: (data) => setSuccessOrderNumber(data.orderNumber),
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
    defaultValues: { measurementUnit: "inches", preferredContact: undefined },
  });

  const submitting = createOrder.isPending;
  const measurementUnit = watch("measurementUnit");
  const preferredContact = watch("preferredContact");

  const onSubmit = (values: FormValues) => {
    const { description, neededBy, ...rest } = values;
    // Omit empty optional fields so the server never receives an empty date
    // string (which would fail its date coercion).
    createOrder.mutate({
      data: {
        ...rest,
        ...(description ? { description } : {}),
        ...(neededBy ? { neededBy } : {}),
      },
    });
  };

  if (successOrderNumber) {
    return (
      <PageShell noise={false}>
        <div className="w-full max-w-lg text-center animate-in fade-in zoom-in-95 duration-700">
          <CheckCircle className="w-16 h-16 text-primary mx-auto mb-6" strokeWidth={1} />
          <h1 className="text-3xl font-serif mb-3">Order Received</h1>
          <p className="text-muted-foreground font-light mb-8">
            Thank you! We'll be in touch soon to confirm your details.
          </p>
          <div className="border border-border rounded-lg p-6 mb-8 inline-block">
            <p className="text-xs tracking-[0.15em] uppercase text-muted-foreground mb-1">Your order number</p>
            <p className="text-2xl font-mono font-medium text-primary tracking-widest">{successOrderNumber}</p>
          </div>
          <p className="text-sm text-muted-foreground mb-8">
            Save this number — you can use it to track your order status at any time.
          </p>
          <a
            href={BASE_URL + "/shop/status"}
            className="inline-flex items-center gap-2 text-sm tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Track order status
          </a>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell align="top" noise={false}>
      <div className="max-w-2xl mx-auto px-6 pt-24 pb-12">
        <div className="mb-10">
          <Link
            to="/shop/status"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors tracking-widest uppercase mb-8 group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Track my order
          </Link>
          <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-3">Place an Order</h1>
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
                <Label htmlFor="fullName" className="text-sm font-light tracking-wide">
                  Full Name <span className="text-primary">*</span>
                </Label>
                <Input
                  id="fullName"
                  {...register("fullName")}
                  placeholder="Your full name"
                  className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none"
                />
                {errors.fullName && (
                  <p className="text-destructive text-xs mt-1">{errors.fullName.message}</p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <Label htmlFor="email" className="text-sm font-light tracking-wide">
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
                    <p className="text-destructive text-xs mt-1">{errors.email.message}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="phone" className="text-sm font-light tracking-wide">
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
                    <p className="text-destructive text-xs mt-1">{errors.phone.message}</p>
                  )}
                </div>
              </div>

              <div>
                <Label className="text-sm font-light tracking-wide">
                  Preferred Contact Method <span className="text-primary">*</span>
                </Label>
                <div className="flex gap-3 mt-2">
                  {(["email", "phone", "text"] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setValue("preferredContact", method, { shouldValidate: true })}
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
                  <p className="text-destructive text-xs mt-1">{errors.preferredContact.message}</p>
                )}
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-6 pb-2 border-b border-border">
              <h2 className="text-xs tracking-[0.2em] uppercase text-muted-foreground">
                Measurements <span className="text-primary">*</span>
              </h2>
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
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
              {([
                { key: "waist", label: "Waist" },
                { key: "bust", label: "Bust" },
                { key: "hips", label: "Hips" },
                { key: "height", label: "Height" },
                { key: "bodyGirth", label: "Body Girth" },
              ] as const).map(({ key, label }) => (
                <div key={key}>
                  <Label htmlFor={key} className="text-sm font-light tracking-wide">
                    {label}
                    <span className="text-muted-foreground/60 ml-1 text-xs">({measurementUnit})</span>
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
                    <p className="text-destructive text-xs mt-1">{errors[key]?.message}</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-6 pb-2 border-b border-border">
              Dress Details
            </h2>
            <div className="space-y-6">
              <div>
                <Label htmlFor="description" className="text-sm font-light tracking-wide">
                  Description / Notes
                  <span className="text-muted-foreground/60 ml-1 text-xs">(optional)</span>
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
                <Label htmlFor="neededBy" className="text-sm font-light tracking-wide">
                  Needed By
                  <span className="text-muted-foreground/60 ml-1 text-xs">(optional)</span>
                </Label>
                <Input
                  id="neededBy"
                  type="date"
                  {...register("neededBy")}
                  className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none w-48"
                />
              </div>
            </div>
          </section>

          <div className="flex justify-center pt-4 pb-8">
            <Button
              type="submit"
              disabled={submitting}
              className="bg-primary text-primary-foreground hover:bg-primary/90 px-10 py-6 rounded-full tracking-widest uppercase text-xs transition-all duration-300 hover:shadow-[0_0_20px_rgba(209,156,151,0.2)] disabled:opacity-50"
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
