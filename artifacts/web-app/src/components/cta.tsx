import type { AnchorHTMLAttributes, ReactNode } from "react";
import { Link } from "wouter";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The atelier's signature "pill" call-to-action styling. Both the marketing
 * `<Link>` CTAs (via `<CtaLink>`) and the form-submit `<Button>`s
 * (`className={ctaVariants({ … })}`) share this one source, so the padding,
 * uppercase tracking, and rose-gold glow can't drift per call site the way the
 * hand-copied classNames used to. The glow reads `--glow-primary`, derived from
 * the `primary` token — never a hardcoded rose literal.
 */
export const ctaVariants = cva(
  "group inline-flex items-center justify-center gap-2 rounded-full uppercase tracking-widest text-xs transition-all duration-300 disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-[0_0_24px_var(--glow-primary)]",
        outline:
          "border border-border text-foreground hover:border-primary hover:text-primary",
      },
      size: {
        default: "px-8 py-4",
        lg: "px-10 py-6",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

type CtaLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> &
  VariantProps<typeof ctaVariants> & {
    to: string;
    children: ReactNode;
  };

/** A wouter `<Link>` wearing the shared pill CTA styling. */
export function CtaLink({
  to,
  variant,
  size,
  className,
  children,
  ...props
}: CtaLinkProps) {
  return (
    <Link to={to} className={cn(ctaVariants({ variant, size }), className)} {...props}>
      {children}
    </Link>
  );
}
