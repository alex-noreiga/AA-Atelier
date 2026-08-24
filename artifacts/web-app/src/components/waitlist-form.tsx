import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useJoinWaitlist } from "@workspace/api-client-react";
import { CalendarClock, CheckCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { HoneypotField, honeypotSchema, useSubmitTimer } from "@/lib/anti-spam";

// Form-friendly schema. Its output is handed to the `useJoinWaitlist` mutation,
// whose `data` is typed as the generated `NewWaitlistRequest`, so this can't
// silently drift from the contract.
//
// Deliberately much lighter than the order form: someone told the studio is
// full is being asked for their patience, and a five-step intake is a poor way
// to ask for it. Name and email are all that's required — everything else helps
// the atelier work the list in the right order but is the customer's to skip.
const formSchema = z.object({
  name: z.string().min(1, "Please enter your name"),
  email: z.string().email("Please enter a valid email address"),
  phone: z.string().optional(),
  eventName: z.string().optional(),
  neededBy: z.string().optional(),
  notes: z.string().optional(),
  ...honeypotSchema,
});

type FormValues = z.infer<typeof formSchema>;

interface WaitlistFormProps {
  /** The atelier's own explanation of why the books are closed. */
  message: string;
}

/**
 * The waitlist, shown in place of the intake form when the studio's books are
 * closed for bespoke commissions.
 *
 * Its job is to keep a customer who arrived ready to order, so it says three
 * things a bare "we're full" doesn't: what happens next, that nothing is being
 * charged or committed, and that the three services worked on a piece they
 * already own are still open. The last is the one most likely to be useful
 * today, and is invisible if we don't say it — the form they were sent to is
 * the one that just closed.
 *
 * Deliberately light: someone told the studio is full is being asked for their
 * patience, and a five-step intake is a poor way to ask for it. Name and email
 * are all that's required; what they're skating and when they need it are free
 * text, because the studio can't hold a list of every competition and doesn't
 * need one to work a list of names in date order.
 */
export function WaitlistForm({ message }: WaitlistFormProps) {
  const { toast } = useToast();

  const join = useJoinWaitlist({
    mutation: {
      onError: (error) => {
        const description =
          error.data?.error ||
          error.message ||
          "Something went wrong. Please try again.";
        toast({
          variant: "destructive",
          title: "Couldn't add you to the list",
          description,
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

  const onSubmit = (values: FormValues) => {
    join.mutate({
      data: {
        name: values.name,
        email: values.email,
        ...(values.phone ? { phone: values.phone } : {}),
        ...(values.eventName ? { eventName: values.eventName } : {}),
        ...(values.neededBy ? { neededBy: values.neededBy } : {}),
        ...(values.notes ? { notes: values.notes } : {}),
        website: values.website ?? "",
        elapsedMs: elapsedMs(),
      },
    });
  };

  if (join.isSuccess) {
    return (
      <div
        className="border border-border rounded-lg p-8 text-center"
        data-testid="waitlist-success"
      >
        <CheckCircle
          className="w-8 h-8 text-primary mx-auto mb-4"
          strokeWidth={1.25}
        />
        <h2 className="text-2xl font-serif text-foreground mb-3">
          You&rsquo;re on the list
        </h2>
        <p className="text-muted-foreground font-light">
          Thank you for your patience. We&rsquo;ll write to you as soon as a
          space opens up &mdash; before we reopen commissions publicly. Nothing
          is booked and there&rsquo;s nothing to pay.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-10" data-testid="waitlist-form">
      <div className="border border-border rounded-lg p-6 flex gap-4">
        <CalendarClock
          className="w-5 h-5 text-primary shrink-0 mt-0.5"
          strokeWidth={1.5}
        />
        <div>
          <h2 className="text-lg font-serif text-foreground mb-1">
            Our books are closed
          </h2>
          <p className="text-sm text-muted-foreground font-light">{message}</p>
        </div>
      </div>

      <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        <HoneypotField registration={register("website")} />

        <div className="grid sm:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="waitlist-name">Name</Label>
            <Input
              id="waitlist-name"
              data-testid="input-waitlist-name"
              {...register("name")}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="waitlist-email">Email</Label>
            <Input
              id="waitlist-email"
              type="email"
              data-testid="input-waitlist-email"
              {...register("email")}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="waitlist-phone">
            Phone <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="waitlist-phone"
            type="tel"
            data-testid="input-waitlist-phone"
            {...register("phone")}
          />
        </div>

        {/* What the piece is for. Both are free text: the studio can't keep a
            list of every competition run nationally and internationally, but
            the skater knows theirs — and the date is what the atelier works
            the list in order of. */}
        <div className="grid sm:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="waitlist-event">
              What are you skating?{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="waitlist-event"
              placeholder="Competition, test session, show..."
              data-testid="input-waitlist-event"
              {...register("eventName")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="waitlist-needed-by">
              When do you need it?{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="waitlist-needed-by"
              type="date"
              data-testid="input-waitlist-needed-by"
              {...register("neededBy")}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="waitlist-notes">
            What do you have in mind?{" "}
            <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="waitlist-notes"
            rows={3}
            placeholder="A line about the piece — discipline, style, colours..."
            data-testid="input-waitlist-notes"
            {...register("notes")}
          />
        </div>

        <Button
          type="submit"
          disabled={join.isPending}
          data-testid="button-join-waitlist"
        >
          {join.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Adding you&hellip;
            </>
          ) : (
            "Join the waitlist"
          )}
        </Button>
      </form>
    </div>
  );
}
