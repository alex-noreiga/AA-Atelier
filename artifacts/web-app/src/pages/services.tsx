import {
  ArrowRight,
  Heart,
  PenLine,
  Ruler,
  Scissors,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { CtaLink } from "@/components/cta";
import { SectionHeader } from "@/components/section-header";
import { Seo } from "@/components/seo";
import { ROUTE_SEO } from "@/lib/seo-routes";

interface Service {
  icon: LucideIcon;
  title: string;
  description: string;
}

const SERVICES: Service[] = [
  {
    icon: Scissors,
    title: "Bespoke Commissions",
    description:
      "Designed and made entirely for you — from first consultation and sketch through pattern-making, construction, and hand-finishing. Each costume is built from scratch to suit your body, your program, and your vision.",
  },
  {
    icon: Ruler,
    title: "Fittings & Alterations",
    description:
      "In-person fittings and precise adjustments to perfect line, comfort, and movement — so your costume feels like a second skin, whether you're competing or performing.",
  },
  {
    icon: Sparkles,
    title: "Rhinestoning & Embellishment",
    description:
      "Hand-applied crystals, beading, and detailing that catch the light. Offered on our own commissions or as a standalone service for a costume you already own.",
  },
  {
    icon: Heart,
    title: "Repairs & Restoration",
    description:
      "Mending, refreshing, and restoring beloved costumes — from re-securing stones to reworking seams — giving a treasured piece another season.",
  },
];

const PROCESS: { step: string; title: string; description: string }[] = [
  {
    step: "01",
    title: "Consultation",
    description:
      "We talk through your vision, program, measurements, and timeline.",
  },
  {
    step: "02",
    title: "Design & Sourcing",
    description:
      "We sketch your costume and curate fabrics, laces, and embellishments.",
  },
  {
    step: "03",
    title: "Handcrafting & Fitting",
    description:
      "Patterned, cut, and constructed by hand and machine, refined through fittings.",
  },
  {
    step: "04",
    title: "Detailing & Delivery",
    description:
      "Crystals and final touches applied, then ready for pickup or delivery.",
  },
];

export default function Services() {
  return (
    <PageShell align="top">
      <Seo {...ROUTE_SEO["/services"]} />
      <div className="w-full max-w-3xl z-10 mx-auto px-6 pt-24 pb-20 animate-in fade-in zoom-in-95 duration-1000">
        {/* Header */}
        <div className="text-center">
          <p className="text-primary text-xs tracking-[0.35em] uppercase mb-8">
            A.A Atelier
          </p>
          <h1 className="text-5xl md:text-7xl font-serif text-foreground leading-[1.05] mb-8">
            Services
          </h1>
          <p className="text-muted-foreground font-light text-lg md:text-xl max-w-xl mx-auto leading-relaxed">
            Every piece begins as a conversation and ends as something made only
            for you —{" "}
            <span className="italic text-primary">
              bespoke costumes crafted by hand
            </span>{" "}
            for the ice and the stage.
          </p>
        </div>

        {/* Service cards */}
        <div className="mt-24 grid sm:grid-cols-2 gap-6 md:gap-8">
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
              <h2 className="font-serif text-2xl md:text-3xl text-foreground mb-3">
                {title}
              </h2>
              <p className="text-muted-foreground font-light leading-relaxed">
                {description}
              </p>
            </div>
          ))}
        </div>

        {/* How it works */}
        <div className="mt-24">
          <SectionHeader
            eyebrow="The Process"
            title="From first sketch to final stitch"
          />
          <ol className="grid gap-8 md:grid-cols-4">
            {PROCESS.map(({ step, title, description }) => (
              <li key={step}>
                <span className="block font-serif text-4xl text-primary/70 mb-3">
                  {step}
                </span>
                <h3 className="font-serif text-xl text-foreground mb-2">
                  {title}
                </h3>
                <p className="text-muted-foreground font-light text-sm leading-relaxed">
                  {description}
                </p>
              </li>
            ))}
          </ol>
        </div>

        {/* CTA */}
        <div className="mt-24 flex flex-col sm:flex-row items-center justify-center gap-4">
          <CtaLink to="/order" data-testid="cta-begin-commission">
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
      </div>
    </PageShell>
  );
}
