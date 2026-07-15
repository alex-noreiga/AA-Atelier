import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { PageShell } from "@/components/page-shell";

interface SuccessScreenProps {
  /** The confirmation glyph (e.g. `CheckCircle`, `CalendarCheck`). */
  icon: LucideIcon;
  /** The `h1` headline, e.g. "Order Received". */
  title: string;
  /** One or two sentences under the headline. */
  description: ReactNode;
  /** Optional detail block (order-number box, appointment details, …). */
  children?: ReactNode;
  /** Optional trailing action, e.g. a back `<Link>`. */
  footer?: ReactNode;
}

/**
 * The shared post-submit confirmation screen used by the order, contact, and
 * appointment flows. Owns the (noise-free) `PageShell`, centering, icon size,
 * headline, and description so the three "you're done" screens can't drift; the
 * per-flow detail card and any back-link come in as `children` / `footer`.
 */
export function SuccessScreen({
  icon: Icon,
  title,
  description,
  children,
  footer,
}: SuccessScreenProps) {
  return (
    <PageShell noise={false}>
      <div className="w-full max-w-lg text-center animate-in fade-in zoom-in-95 duration-700">
        <Icon className="w-16 h-16 text-primary mx-auto mb-6" strokeWidth={1} />
        <h1 className="text-3xl font-serif mb-3">{title}</h1>
        <p className="text-muted-foreground font-light mb-8">{description}</p>
        {children}
        {footer}
      </div>
    </PageShell>
  );
}
