import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useSubscribeNewsletter } from "@workspace/api-client-react";
import { CheckCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { HoneypotField, honeypotSchema, useSubmitTimer } from "@/lib/anti-spam";

// Form-friendly schema. Its output is handed to the `useSubscribeNewsletter`
// mutation below, whose `data` is typed as the generated `NewNewsletterRequest`,
// so the form cannot silently drift from the API contract.
const formSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  ...honeypotSchema,
});

type FormValues = z.infer<typeof formSchema>;

interface NewsletterSignupProps {
  /**
   * Where the opt-in came from ("footer"), recorded on the Notion row for the
   * atelier's own segmentation. The customer never sees it.
   */
  source: string;
}

/**
 * Marketing mailing-list opt-in — asks only for an email. Files its own tagged
 * row in Notion (the marketing counterpart to the transactional captures) and
 * sends a best-effort welcome email. Rendered in the global footer, but kept a
 * standalone component so it stays testable in isolation and reusable elsewhere.
 */
export function NewsletterSignup({ source }: NewsletterSignupProps) {
  const { toast } = useToast();

  const subscribe = useSubscribeNewsletter({
    mutation: {
      onError: (error) => {
        const message =
          error.data?.error ||
          error.message ||
          "Something went wrong. Please try again.";
        toast({
          variant: "destructive",
          title: "Couldn't sign you up",
          description: message,
        });
      },
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  const elapsedMs = useSubmitTimer();

  const onSubmit = ({ email, website }: FormValues) => {
    subscribe.mutate({
      data: { email, source, website: website ?? "", elapsedMs: elapsedMs() },
    });
  };

  if (subscribe.isSuccess) {
    return (
      <div
        className="flex items-center gap-2 text-sm text-muted-foreground"
        data-testid="newsletter-success"
      >
        <CheckCircle
          className="w-4 h-4 text-primary shrink-0"
          strokeWidth={1.5}
        />
        You're on the list. Thank you for subscribing.
      </div>
    );
  }

  return (
    // noValidate: zod owns validation, so the browser's own bubble can't
    // pre-empt our inline message.
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-3"
      data-testid="newsletter-form"
    >
      <HoneypotField registration={register("website")} />
      <Input
        type="email"
        {...register("email")}
        placeholder="you@example.com"
        aria-label="Email address"
        data-testid="newsletter-email"
        className="bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none"
      />
      {errors.email && (
        <p className="text-destructive text-xs" data-testid="newsletter-error">
          {errors.email.message}
        </p>
      )}
      <Button
        type="submit"
        disabled={subscribe.isPending}
        data-testid="newsletter-submit"
        className="bg-primary text-primary-foreground hover:bg-primary/90 py-5 rounded-full tracking-widest uppercase text-xs transition-all duration-300 disabled:opacity-50"
      >
        {subscribe.isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Subscribing...
          </>
        ) : (
          "Subscribe"
        )}
      </Button>
    </form>
  );
}
