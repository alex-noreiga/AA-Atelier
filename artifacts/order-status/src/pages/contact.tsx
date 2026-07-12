import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useSearch } from "wouter";
import { useCreateContactMessage } from "@workspace/api-client-react";
import { getProductName } from "@/pages/shop";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageShell } from "@/components/page-shell";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, AtSign, CheckCircle, Loader2, Mail, MapPin } from "lucide-react";

// TODO: replace these placeholders with the atelier's real details before shipping.
const CONTACT_EMAIL = "alexandra@a3iceanddance.com";
const CONTACT_LOCATION = "Huntsville, Alabama — by appointment";
const INSTAGRAM_HANDLE = "@a3iceanddance";
const INSTAGRAM_URL = "https://instagram.com/a3iceanddance";

// Form-friendly schema (friendly messages). Its output shape is handed to the
// `useCreateContactMessage` mutation below, whose `data` is typed as the
// generated `NewContactRequest`, so the form cannot silently drift from the
// API contract.
const formSchema = z.object({
  name: z.string().min(1, "Your name is required"),
  email: z.string().email("Please enter a valid email address"),
  phone: z.string().optional(),
  message: z.string().min(1, "Please enter a message"),
});

type FormValues = z.infer<typeof formSchema>;

export default function Contact() {
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  // When arriving from the Shop via `/contact?item=<slug>`, prefill the message
  // with a reservation enquiry so the customer only has to add their size.
  const search = useSearch();
  const itemSlug = new URLSearchParams(search).get("item");
  const itemName = itemSlug ? getProductName(itemSlug) : undefined;
  const defaultMessage = itemName
    ? `I'd like to reserve: ${itemName}.\nMy size: `
    : "";

  const createMessage = useCreateContactMessage({
    mutation: {
      onSuccess: () => setSubmitted(true),
      onError: (error) => {
        const message =
          error.data?.error ||
          error.message ||
          "Something went wrong. Please try again.";
        toast({
          variant: "destructive",
          title: "Message failed to send",
          description: message,
        });
      },
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { message: defaultMessage },
  });

  const submitting = createMessage.isPending;

  const onSubmit = (values: FormValues) => {
    const { phone, ...rest } = values;
    createMessage.mutate({
      data: {
        ...rest,
        ...(phone ? { phone } : {}),
      },
    });
  };

  if (submitted) {
    return (
      <PageShell noise={false}>
        <div className="w-full max-w-lg text-center animate-in fade-in zoom-in-95 duration-700">
          <CheckCircle className="w-16 h-16 text-primary mx-auto mb-6" strokeWidth={1} />
          <h1 className="text-3xl font-serif mb-3">Message Sent</h1>
          <p className="text-muted-foreground font-light mb-8">
            Thank you for reaching out — we'll be in touch soon.
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors"
          >
            Back to home
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell align="top" noise={false}>
      <div className="max-w-2xl mx-auto px-6 pt-24 pb-16">
        <div className="mb-10 text-center">
          <p className="text-primary text-xs tracking-[0.35em] uppercase mb-6">
            A.A Atelier
          </p>
          <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-3">Contact Us</h1>
          <p className="text-muted-foreground font-light text-lg">
            Get in touch to begin your commission or ask us anything.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
          <div>
            <Label htmlFor="name" className="text-sm font-light tracking-wide">
              Name <span className="text-primary">*</span>
            </Label>
            <Input
              id="name"
              {...register("name")}
              placeholder="Your name"
              className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none"
            />
            {errors.name && (
              <p className="text-destructive text-xs mt-1">{errors.name.message}</p>
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
                Phone
                <span className="text-muted-foreground/60 ml-1 text-xs">(optional)</span>
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
            <Label htmlFor="message" className="text-sm font-light tracking-wide">
              Message <span className="text-primary">*</span>
            </Label>
            <Textarea
              id="message"
              {...register("message")}
              placeholder="Tell us how we can help..."
              rows={5}
              className="mt-1.5 bg-transparent border border-border rounded-lg px-3 py-2 text-sm focus-visible:ring-0 focus-visible:border-primary transition-colors resize-none shadow-none"
            />
            {errors.message && (
              <p className="text-destructive text-xs mt-1">{errors.message.message}</p>
            )}
          </div>

          <div className="flex justify-center pt-2">
            <Button
              type="submit"
              disabled={submitting}
              className="bg-primary text-primary-foreground hover:bg-primary/90 px-10 py-6 rounded-full tracking-widest uppercase text-xs transition-all duration-300 hover:shadow-[0_0_20px_rgba(209,156,151,0.2)] disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send Message"
              )}
            </Button>
          </div>
        </form>

        {/* Supporting contact details */}
        <div className="mt-16 pt-10 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-8">
          <div>
            <h2 className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
              Reach Us
            </h2>
            <ul className="space-y-3 text-sm font-light">
              <li>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="inline-flex items-center gap-3 text-foreground hover:text-primary transition-colors"
                >
                  <Mail className="w-4 h-4 text-primary" strokeWidth={1.5} />
                  {CONTACT_EMAIL}
                </a>
              </li>
              <li className="inline-flex items-center gap-3 text-muted-foreground">
                <MapPin className="w-4 h-4 text-primary" strokeWidth={1.5} />
                {CONTACT_LOCATION}
              </li>
              <li>
                <a
                  href={INSTAGRAM_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-3 text-foreground hover:text-primary transition-colors"
                >
                  <AtSign className="w-4 h-4 text-primary" strokeWidth={1.5} />
                  {INSTAGRAM_HANDLE}
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
              Custom Orders
            </h2>
            <p className="text-sm font-light text-muted-foreground mb-4 leading-relaxed">
              Ready to commission a custom costume? Start with our order form and
              we'll bring your vision to life.
            </p>
            <Link
              to="/order"
              className="inline-flex items-center gap-2 text-xs tracking-widest uppercase text-primary hover:gap-3 transition-all group"
            >
              Place an order
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
