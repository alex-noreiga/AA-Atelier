import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateBackInStockRequest } from "@workspace/api-client-react";
import { Bell, CheckCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

// Form-friendly schema. Its output is handed to the `useCreateBackInStockRequest`
// mutation below, whose `data` is typed as the generated `NewNotifyRequest`, so
// the form cannot silently drift from the API contract.
const formSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type FormValues = z.infer<typeof formSchema>;

interface NotifyDialogProps {
  /** The sold-out variant's name, e.g. "Bow Fleece Soaker — Black". */
  item: string;
  /** Set only when one specific sold-out size band was asked about. */
  size?: string;
  /**
   * The caller's own trigger element, handed the opener so the shop keeps its
   * existing bell CTA / strikethrough size chip markup unchanged.
   */
  trigger: (open: () => void) => ReactNode;
}

/**
 * "Notify me when it's back" — asks for nothing but an email, because the item
 * and size are already known from the card the customer clicked. The request is
 * filed as its own row in Notion, so it can be answered in a restock sweep
 * rather than read out of a free-text contact message.
 *
 * Controlled (not `DialogTrigger asChild`) because a shop card's trigger can sit
 * inside the quick-view Dialog, and nesting radix dialogs fights over the focus
 * trap.
 */
export function NotifyDialog({ item, size, trigger }: NotifyDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  const label = size ? `${item} — ${size}` : item;

  const createRequest = useCreateBackInStockRequest({
    mutation: {
      onSuccess: () => setSubmitted(true),
      onError: (error) => {
        const message =
          error.data?.error ||
          error.message ||
          "Something went wrong. Please try again.";
        toast({
          variant: "destructive",
          title: "Couldn't save your request",
          description: message,
        });
      },
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  const onSubmit = ({ email }: FormValues) => {
    createRequest.mutate({ data: { email, item, ...(size ? { size } : {}) } });
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      // Closing discards the previous attempt, so reopening starts clean.
      setSubmitted(false);
      reset();
    }
  };

  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md" data-testid="notify-dialog">
          {submitted ? (
            <div className="py-6 text-center" data-testid="notify-success">
              <CheckCircle
                className="w-12 h-12 text-primary mx-auto mb-5"
                strokeWidth={1}
              />
              <DialogTitle className="font-serif text-2xl mb-2">
                You're on the list
              </DialogTitle>
              <DialogDescription className="text-muted-foreground font-light">
                We'll email you as soon as{" "}
                <span className="text-foreground">{label}</span> is back in
                stock.
              </DialogDescription>
            </div>
          ) : (
            <>
              <DialogHeader className="text-left">
                <DialogTitle className="font-serif text-2xl flex items-center gap-2">
                  <Bell className="w-4 h-4 text-primary" />
                  Notify me
                </DialogTitle>
                <DialogDescription className="text-muted-foreground font-light">
                  Leave your email and we'll let you know the moment{" "}
                  <span className="text-foreground">{label}</span> is back in
                  stock.
                </DialogDescription>
              </DialogHeader>

              {/* noValidate: zod owns validation, so the browser's own bubble
                  can't pre-empt our inline message. */}
              <form
                noValidate
                onSubmit={handleSubmit(onSubmit)}
                className="mt-2 space-y-6"
              >
                <div>
                  <Label
                    htmlFor="notify-email"
                    className="text-sm font-light tracking-wide"
                  >
                    Email <span className="text-primary">*</span>
                  </Label>
                  <Input
                    id="notify-email"
                    type="email"
                    autoFocus
                    {...register("email")}
                    placeholder="you@example.com"
                    data-testid="notify-email"
                    className="mt-1.5 bg-transparent border-0 border-b border-border rounded-none px-0 py-3 focus-visible:ring-0 focus-visible:border-primary transition-colors shadow-none"
                  />
                  {errors.email && (
                    <p className="text-destructive text-xs mt-1">
                      {errors.email.message}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={createRequest.isPending}
                  data-testid="notify-submit"
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 py-6 rounded-full tracking-widest uppercase text-xs transition-all duration-300 disabled:opacity-50"
                >
                  {createRequest.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Notify me"
                  )}
                </Button>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
