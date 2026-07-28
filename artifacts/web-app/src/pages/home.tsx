import {
  ArrowRight,
  Heart,
  PenLine,
  Ruler,
  Scissors,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { CtaLink } from "@/components/cta";
import { SectionHeader } from "@/components/section-header";
import { Seo } from "@/components/seo";
import { ROUTE_SEO } from "@/lib/seo-routes";

// A trimmed teaser of the four offerings on /services — same icons and titles,
// one-line descriptions for the homepage. The full copy lives in pages/services.tsx.
const SERVICES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: Scissors,
    title: "Bespoke Commissions",
    description:
      "Designed and made entirely for you — from first sketch to final hand-finishing.",
  },
  {
    icon: Ruler,
    title: "Fittings & Alterations",
    description:
      "In-person fittings and precise adjustments for perfect line, comfort, and movement.",
  },
  {
    icon: Sparkles,
    title: "Rhinestoning & Embellishment",
    description:
      "Hand-applied crystals and detailing that catch the light — on our work or your own.",
  },
  {
    icon: Heart,
    title: "Repairs & Restoration",
    description:
      "Mending and restoring beloved costumes for another season on the ice.",
  },
];

export default function Home() {
  return (
    <PageShell align="top">
      <Seo {...ROUTE_SEO["/"]} />
      <div className="w-full max-w-3xl z-10 mx-auto px-6 pt-24 pb-20 animate-in fade-in zoom-in-95 duration-1000">
        {/* Hero — compact so the Services section peeks above the fold */}
        <div className="min-h-[68vh] flex flex-col justify-center text-center">
          {/* Eyebrow */}
          <p className="text-primary text-xs tracking-[0.35em] uppercase mb-8">
            A Custom Figure Skating Costume Atelier
          </p>

          {/* Headline */}
          <h1 className="text-5xl md:text-7xl font-serif text-foreground leading-[1.05] mb-8">
            Costumes made
            <br />
            <span className="italic text-primary">just for you</span>
          </h1>

          <p className="text-muted-foreground font-light text-lg md:text-xl max-w-xl mx-auto mb-12 leading-relaxed">
            From first sketch to final stitch, we craft one-of-a-kind pieces by
            hand. Begin a new commission, or follow your costume's journey
            through our atelier.
          </p>

          {/* Primary actions */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <CtaLink to="/order" data-testid="cta-place-order">
              <PenLine className="w-4 h-4" />
              Begin a Commission
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </CtaLink>
            <CtaLink
              to="/track"
              variant="outline"
              data-testid="cta-order-status"
            >
              <Search className="w-4 h-4" />
              Track Your Order
            </CtaLink>
          </div>
        </div>

        {/* Services preview */}
        <div className="mt-24">
          <SectionHeader eyebrow="What We Make" title="Bespoke, by hand" />
          <div className="grid sm:grid-cols-2 gap-6 md:gap-8">
            {SERVICES.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="border border-border/60 rounded-2xl p-8 hover:border-primary/50 transition-colors"
                data-testid={`service-${title
                  .toLowerCase()
                  .replace(/[^a-z]+/g, "-")
                  .replace(/^-|-$/g, "")}`}
              >
                <Icon className="w-6 h-6 text-primary mb-5" strokeWidth={1.5} />
                <h3 className="font-serif text-2xl md:text-3xl text-foreground mb-3">
                  {title}
                </h3>
                <p className="text-muted-foreground font-light leading-relaxed">
                  {description}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-12 text-center">
            <CtaLink
              to="/services"
              variant="outline"
              data-testid="cta-explore-services"
            >
              Explore Services
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </CtaLink>
          </div>
        </div>

        {/* Our Story teaser */}
        <div className="mt-24" data-testid="story-teaser">
          <SectionHeader eyebrow="Our Story" title="Founded by skaters" />
          <p className="max-w-2xl mx-auto text-center text-muted-foreground font-light text-lg leading-relaxed">
            A.A. Atelier is a local, women owned business founded by figure
            skaters. Our mission is to bring your ideas to life — custom
            costumes and accessories that are as unique as you are, handmade
            with care, creativity, and attention to detail.
          </p>
          <p className="mt-12 text-center font-serif italic text-2xl md:text-3xl text-primary">
            Come with a vision and leave with confidence.
          </p>
          <div className="mt-12 text-center">
            <CtaLink to="/about" variant="outline" data-testid="cta-read-story">
              Read Our Story
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </CtaLink>
          </div>
        </div>

        {/* Closing CTA */}
        <div className="mt-24 pt-16 border-t border-border">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <CtaLink to="/order" data-testid="cta-commission-closing">
              <PenLine className="w-4 h-4" />
              Begin a Commission
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </CtaLink>
            <CtaLink
              to="/contact"
              variant="outline"
              data-testid="cta-ask-question"
            >
              Ask a Question
            </CtaLink>
          </div>

          {/* Footer whisper */}
          <p className="mt-16 text-center text-muted-foreground/50 text-xs tracking-[0.2em] uppercase font-light">
            Bespoke · Handcrafted · Made to measure
          </p>
        </div>
      </div>
    </PageShell>
  );
}
