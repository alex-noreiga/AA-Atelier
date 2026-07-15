import { ArrowRight, PenLine } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { CtaLink } from "@/components/cta";
import { SectionHeader } from "@/components/section-header";
import { Seo } from "@/components/seo";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQS: { question: string; answer: string }[] = [
  {
    question: "How long does a custom costume take?",
    answer:
      "Most commissions take six to eight weeks from consultation to final fitting. Competition season fills quickly, so we recommend booking a few months ahead of the date you need the costume in hand to account for any supply chain issues along the way.",
  },
  {
    question: "How do I get measured?",
    answer:
      "The order form walks you through every measurement we need. If you need help measuring yourself, or your skater, feel free to schedule an appointment with Alexandra.",
  },
  {
    question: "What does a commission cost?",
    answer:
      "Price depends on the fabric, the amount of embellishment, and the complexity of the design. We quote each piece after the consultation, once we know what your commission calls for.",
  },
  {
    question: "Can you rush an order?",
    answer:
      "Sometimes, depending on where the calendar stands. Rush work carries an additional fee — reach out before placing your order and we'll tell you honestly whether we can meet your date.",
  },
  {
    question: "Do you ship?",
    answer:
      "Yes! Finished costumes can be shipped to you, or collected in person.",
  },
  {
    question: "Can you alter or rhinestone a costume I already own?",
    answer:
      "We do. Alterations, repairs, and hand-applied crystal work are all offered as standalone services, not only on our own commissions.",
  },
  {
    question: "How do I care for my costume?",
    answer:
      "Hand wash in cold water with a gentle detergent and lay flat to dry. Never dry-clean or machine dry a crystalled piece — the solvents and heat loosen the adhesive.",
  },
];

const faqTestId = (question: string) =>
  question
    .toLowerCase()
    .replace(/[^a-z]+/g, "-")
    .replace(/^-|-$/g, "");

export default function About() {
  return (
    <PageShell align="top">
      <Seo
        title="About A.A Atelier — Custom Skating Costume Studio"
        description="Meet A.A Atelier, the custom figure skating and dance costume studio behind A3 Ice and Dance. Answers on timelines, measuring, pricing, rush orders, and shipping."
        path="/about"
      />
      <div className="w-full max-w-3xl z-10 mx-auto px-6 pt-24 pb-20 animate-in fade-in zoom-in-95 duration-1000">
        {/* Header */}
        <div className="text-center">
          <p className="text-primary text-xs tracking-[0.35em] uppercase mb-8">
            A.A Atelier
          </p>
          <h1 className="text-5xl md:text-7xl font-serif text-foreground leading-[1.05] mb-8">
            About
          </h1>
          <p className="text-muted-foreground font-light text-lg md:text-xl max-w-xl mx-auto leading-relaxed">
            A small atelier devoted to figure skating and dance costumes made
            just for you.
          </p>
        </div>

        {/* Story */}
        <div className="mt-24" data-testid="story-section">
          <SectionHeader eyebrow="Our Story" title="Founded by skaters" />
          <div className="max-w-2xl mx-auto space-y-6 text-muted-foreground font-light text-lg leading-relaxed">
            <p>
              A.A. Atelier is a local, women owned business founded by figure
              skaters. We understand performative ice and dance attire can be
              expensive or not quite what you envisioned. That's why our mission
              is to bring your ideas to life by creating custom dresses and
              accessories that are as unique as you are.
            </p>
            <p>
              Whether you're dancing on stage or competing on ice, we want you
              to feel empowered when you step into the spotlight. Everything we
              make is handmade to your liking with care, creativity, and
              attention to detail.
            </p>
            <p>
              We are proud to create a product that fits your style and leaves
              you feeling ready to perform.
            </p>
          </div>
          <p className="mt-12 text-center font-serif italic text-2xl md:text-3xl text-primary">
            Come with a vision and leave with confidence.
          </p>
        </div>

        {/* FAQ */}
        <div className="mt-24" data-testid="faq-section">
          <SectionHeader eyebrow="Questions" title="Frequently asked" />
          <Accordion type="single" collapsible className="w-full">
            {FAQS.map(({ question, answer }) => (
              <AccordionItem
                key={question}
                value={question}
                className="border-border/60"
                data-testid={`faq-${faqTestId(question)}`}
              >
                <AccordionTrigger className="font-serif text-lg md:text-xl text-foreground text-left py-6 hover:no-underline hover:text-primary">
                  {question}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground font-light text-base leading-relaxed pb-6 pr-6">
                  {answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        {/* CTA */}
        <div className="mt-24 flex flex-col sm:flex-row items-center justify-center gap-4">
          <CtaLink to="/order" data-testid="cta-commission-about">
            <PenLine className="w-4 h-4" />
            Begin a Commission
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </CtaLink>
          <CtaLink to="/contact" variant="outline" data-testid="cta-ask-question-about">
            Ask a Question
          </CtaLink>
        </div>
      </div>
    </PageShell>
  );
}
