import {
  ArrowRight,
  Heart,
  PenLine,
  Ruler,
  Scissors,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";
import { PageShell } from "@/components/page-shell";
import { CtaLink } from "@/components/cta";
import { SectionHeader } from "@/components/section-header";
import { Seo, StructuredData, SITE_ORIGIN } from "@/components/seo";
import { ROUTE_SEO } from "@/lib/seo-routes";

interface Service {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Short, honest price anchor shown under the title. */
  price: string;
  /**
   * The intake service this card starts, as a `/order?service=<id>` deep link —
   * the same shape as `/appointments?type=<id>`. The ids are the studio's
   * service catalog (`api-server/src/lib/service-catalog.ts`, served by
   * `GET /services`), which is what decides the fields the order form then asks
   * for; an id that no longer exists simply lands the customer on the picker.
   */
  serviceId: string;
  /** The call to action on the card, phrased for that service. */
  cta: string;
}

const SERVICES: Service[] = [
  {
    icon: Scissors,
    title: "Bespoke Commissions",
    description:
      "Designed and made entirely for you — from first consultation and sketch through pattern-making, construction, and hand-finishing. Each costume is built from scratch to suit your body, your program, and your vision.",
    price: "From a $100 deposit",
    serviceId: "bespoke",
    cta: "Begin a commission",
  },
  {
    icon: Ruler,
    title: "Fittings & Alterations",
    description:
      "In-person fittings and precise adjustments to perfect line, comfort, and movement — so your costume feels like a second skin, whether you're competing or performing.",
    price: "From $50",
    serviceId: "alterations",
    cta: "Request an alteration",
  },
  {
    icon: Sparkles,
    title: "Rhinestoning & Embellishment",
    description:
      "Hand-applied crystals, beading, and detailing that catch the light. Offered on our own commissions or as a standalone service for a costume you already own.",
    price: "From $50",
    serviceId: "rhinestoning",
    cta: "Request rhinestoning",
  },
  {
    icon: Heart,
    title: "Repairs & Restoration",
    description:
      "Mending, refreshing, and restoring beloved costumes — from re-securing stones to reworking seams — giving a treasured piece another season.",
    price: "From $50",
    serviceId: "repairs",
    cta: "Request a repair",
  },
];

const PRICING_STAGES: {
  step: string;
  title: string;
  amount: string;
  description: string;
}[] = [
  {
    step: "01",
    title: "First deposit",
    amount: "$100",
    description:
      "Reserves your place on the calendar and begins your design and first sketch.",
  },
  {
    step: "02",
    title: "Second deposit",
    amount: "$50–$100",
    description:
      "Due at your first fitting — the amount depends on the detailing and customization your piece calls for.",
  },
  {
    step: "03",
    title: "Final balance",
    amount: "Materials + labor",
    description:
      "The remainder, itemized on your invoice and settled when your finished costume is ready.",
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

// schema.org structured data for the studio's offerings, built from the same
// SERVICES array the page renders so the two can't drift (mirrors the About
// page's FAQPage). Communicates to search engines that A.A Atelier offers these
// services, provided by the atelier and served in the US.
const SERVICES_JSON_LD: Record<string, unknown> = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "A.A Atelier Services",
  itemListElement: SERVICES.map((service, index) => ({
    "@type": "ListItem",
    position: index + 1,
    item: {
      "@type": "Service",
      name: service.title,
      description: service.description,
      serviceType: service.title,
      provider: {
        "@type": "Organization",
        name: "A.A Atelier",
        url: SITE_ORIGIN,
      },
      areaServed: "US",
    },
  })),
};

export default function Services() {
  return (
    <PageShell align="top">
      <Seo {...ROUTE_SEO["/services"]} />
      <StructuredData data={SERVICES_JSON_LD} />
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
          {SERVICES.map(
            ({ icon: Icon, title, description, price, serviceId, cta }) => (
              <div
                key={title}
                className="border border-border/60 rounded-2xl p-8 hover:border-primary/50 transition-colors flex flex-col"
                data-testid={`service-${title
                  .toLowerCase()
                  .replace(/[^a-z]+/g, "-")
                  .replace(/^-|-$/g, "")}`}
              >
                <Icon className="w-6 h-6 text-primary mb-5" strokeWidth={1.5} />
                <h2 className="font-serif text-2xl md:text-3xl text-foreground mb-2">
                  {title}
                </h2>
                <p className="text-primary/80 text-xs tracking-[0.2em] uppercase mb-4">
                  {price}
                </p>
                <p className="text-muted-foreground font-light leading-relaxed">
                  {description}
                </p>
                {/* Each service starts its own intake, so the three standalone
                    services are no longer funnelled through a commission form
                    asking for body measurements they don't need. */}
                <Link
                  to={`/order?service=${serviceId}`}
                  className="mt-6 inline-flex items-center gap-2 self-start text-xs tracking-[0.2em] uppercase text-primary hover:gap-3 transition-all group"
                  data-testid={`cta-service-${serviceId}`}
                >
                  {cta}
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </div>
            ),
          )}
        </div>

        {/* Pricing */}
        <div className="mt-24" data-testid="pricing-section">
          <SectionHeader eyebrow="Pricing" title="What to expect" />
          <p className="text-muted-foreground font-light text-lg leading-relaxed max-w-2xl mx-auto text-center">
            Every commission is priced individually — the final cost reflects
            your fabric, the amount of embellishment, and the complexity of the
            design. You'll receive an itemized quote after your consultation,
            and pay in clear stages rather than all at once.
          </p>
          <ol className="mt-14 grid gap-8 md:grid-cols-3">
            {PRICING_STAGES.map(({ step, title, amount, description }) => (
              <li key={step}>
                <span className="block font-serif text-4xl text-primary/70 mb-3">
                  {step}
                </span>
                <h3 className="font-serif text-xl text-foreground mb-1">
                  {title}
                </h3>
                <p className="text-primary/80 text-xs tracking-[0.2em] uppercase mb-2">
                  {amount}
                </p>
                <p className="text-muted-foreground font-light text-sm leading-relaxed">
                  {description}
                </p>
              </li>
            ))}
          </ol>
          <p className="mt-14 text-center text-muted-foreground font-light leading-relaxed max-w-2xl mx-auto">
            Prefer a standalone service? Fittings, alterations, rhinestoning,
            and repairs all start at $50 and are quoted based on the work
            involved.
          </p>
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
          <CtaLink
            to="/order?service=bespoke"
            data-testid="cta-begin-commission"
          >
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
