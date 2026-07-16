import type { ReactNode } from "react";
import { PageShell } from "@/components/page-shell";
import { Seo } from "@/components/seo";
import type { RouteSeo } from "@/lib/seo-routes";

// Shared shell for the static legal/policy pages (Privacy, Terms, Shipping &
// Returns) so their header, intro, "last updated" line, and prose column can't
// drift. Each page passes its ROUTE_SEO entry, a title/intro, and section
// children built with <LegalSection>.

interface LegalPageProps {
  seo: RouteSeo;
  heading: string;
  /** Short lede under the h1. */
  intro: string;
  /** Human-readable date the copy was last reviewed, e.g. "July 16, 2026". */
  lastUpdated: string;
  children: ReactNode;
}

export function LegalPage({
  seo,
  heading,
  intro,
  lastUpdated,
  children,
}: LegalPageProps) {
  return (
    <PageShell align="top">
      <Seo {...seo} />
      <div className="w-full max-w-3xl z-10 mx-auto px-6 pt-24 pb-20 animate-in fade-in zoom-in-95 duration-1000">
        {/* Header */}
        <div className="text-center">
          <p className="text-primary text-xs tracking-[0.35em] uppercase mb-8">
            A.A Atelier
          </p>
          <h1 className="text-4xl md:text-6xl font-serif text-foreground leading-[1.05] mb-8">
            {heading}
          </h1>
          <p className="text-muted-foreground font-light text-lg max-w-xl mx-auto leading-relaxed">
            {intro}
          </p>
          <p className="mt-6 text-xs tracking-[0.15em] uppercase text-muted-foreground/60">
            Last updated {lastUpdated}
          </p>
        </div>

        <div className="mt-16 space-y-12">{children}</div>
      </div>
    </PageShell>
  );
}

interface LegalSectionProps {
  title: string;
  children: ReactNode;
}

/** One titled prose block within a legal page. */
export function LegalSection({ title, children }: LegalSectionProps) {
  return (
    <section>
      <h2 className="font-serif text-2xl text-foreground mb-4">{title}</h2>
      <div className="space-y-4 text-muted-foreground font-light leading-relaxed">
        {children}
      </div>
    </section>
  );
}
