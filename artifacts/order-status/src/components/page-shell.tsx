import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const NOISE_TEXTURE_SVG =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")";

/** Subtle full-viewport noise texture used behind the editorial pages. */
function NoiseTexture() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 opacity-[0.03] mix-blend-overlay"
      style={{ backgroundImage: NOISE_TEXTURE_SVG }}
    />
  );
}

interface PageShellProps {
  children: ReactNode;
  /** Vertically center the content (landing / lookup pages) or top-align it
   *  for long scrolling content (the order form). */
  align?: "center" | "top";
  /** Render the noise-texture background. */
  noise?: boolean;
  className?: string;
}

/**
 * Shared page container for the atelier's editorial pages — the min-height,
 * background, optional centering, and optional noise texture that `home`,
 * `status`, and `order-form` all previously duplicated inline.
 */
export function PageShell({
  children,
  align = "center",
  noise = true,
  className,
}: PageShellProps) {
  return (
    <div
      className={cn(
        "min-h-[100dvh] w-full bg-background",
        align === "center" && "flex flex-col items-center justify-center p-6 pt-24",
        noise && "relative overflow-hidden",
        className,
      )}
    >
      {noise && <NoiseTexture />}
      {children}
    </div>
  );
}
