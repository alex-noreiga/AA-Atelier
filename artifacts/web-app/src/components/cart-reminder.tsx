// The abandoned-cart capture: a small "email me a reminder" form under the cart
// drawer's checkout button. Saves a display snapshot of the cart against the
// email (POST /cart-reminders); the server sends ONE follow-up if the cart is
// never checked out, and a completed checkout with the same email cancels it.
//
// Deliberately explicit and opt-in — the copy says exactly what will happen —
// and carrying the same invisible anti-spam signals as the other anonymous
// captures (hidden honeypot + fill time), since the endpoint is public. Kept a
// standalone component so it stays testable in isolation, like NewsletterSignup.

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRequestCartReminder } from "@workspace/api-client-react";
import { CheckCircle, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useCart } from "@/lib/cart";
import { useToast } from "@/hooks/use-toast";
import { HoneypotField, honeypotSchema, useSubmitTimer } from "@/lib/anti-spam";

// Form-friendly schema. Its output feeds the `useRequestCartReminder` mutation,
// whose `data` is the generated `NewCartReminderRequest`, so the form cannot
// silently drift from the API contract.
const formSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  ...honeypotSchema,
});

type FormValues = z.infer<typeof formSchema>;

export function CartReminder() {
  const { items } = useCart();
  const { toast } = useToast();

  const remind = useRequestCartReminder({
    mutation: {
      onError: (error) => {
        toast({
          variant: "destructive",
          title: "Couldn't save your reminder",
          description:
            error.data?.error ||
            error.message ||
            "Something went wrong. Please try again.",
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
    remind.mutate({
      data: {
        email,
        // A display snapshot for the reminder's copy — the server never trusts
        // any of it for money (checkout reprices from live inventory).
        items: items.map((item) => ({
          variantId: item.variantId,
          name: item.name,
          ...(item.size ? { size: item.size } : {}),
          quantity: item.quantity,
          price: item.price,
        })),
        website: website ?? "",
        elapsedMs: elapsedMs(),
      },
    });
  };

  if (items.length === 0) return null;

  if (remind.isSuccess) {
    return (
      <div
        className="mt-4 flex items-start gap-2 text-xs text-muted-foreground font-light"
        data-testid="cart-reminder-success"
      >
        <CheckCircle
          className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5"
          strokeWidth={1.5}
        />
        <span>
          Saved. If your cart is still waiting in a day or so, we&rsquo;ll send
          you one reminder — and none if you check out.
        </span>
      </div>
    );
  }

  return (
    // noValidate: zod owns validation, so the browser's own bubble can't
    // pre-empt our inline message.
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className="mt-4 border-t border-border/60 pt-4"
      data-testid="cart-reminder-form"
    >
      <HoneypotField registration={register("website")} />
      <p className="text-xs text-muted-foreground font-light">
        Not ready to check out? Leave your email and we&rsquo;ll send you a
        one-time reminder about your cart.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Input
          type="email"
          {...register("email")}
          placeholder="you@example.com"
          aria-label="Email address for a cart reminder"
          data-testid="cart-reminder-email"
          className="h-9 flex-1 bg-transparent text-sm"
        />
        <button
          type="submit"
          disabled={remind.isPending}
          data-testid="cart-reminder-submit"
          className="shrink-0 rounded-full border border-border px-4 py-2 text-[0.65rem] uppercase tracking-widest text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {remind.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            "Remind me"
          )}
        </button>
      </div>
      {errors.email && (
        <p
          className="mt-1 text-destructive text-xs"
          data-testid="cart-reminder-error"
        >
          {errors.email.message}
        </p>
      )}
    </form>
  );
}
