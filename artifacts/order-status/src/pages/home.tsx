import { Link } from "wouter";
import { ArrowRight, PenLine, Search } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center p-6 pt-24 relative overflow-hidden bg-background">
      {/* Subtle background noise texture */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.03] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")",
        }}
      ></div>

      <div className="w-full max-w-2xl z-10 mx-auto text-center animate-in fade-in zoom-in-95 duration-1000">
        {/* Eyebrow */}
        <p className="text-primary text-xs tracking-[0.35em] uppercase mb-8">
          Custom Dress Atelier
        </p>

        {/* Hero */}
        <h1 className="text-5xl md:text-7xl font-serif text-foreground leading-[1.05] mb-8">
          Garments made
          <br />
          <span className="italic text-primary">just for you</span>
        </h1>

        <p className="text-muted-foreground font-light text-lg md:text-xl max-w-xl mx-auto mb-14 leading-relaxed">
          From first sketch to final stitch, we craft one-of-a-kind pieces by
          hand. Begin a new commission, or follow your garment's journey through
          our atelier.
        </p>

        {/* Primary actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            to="/order"
            className="group inline-flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-4 rounded-full tracking-widest uppercase text-xs transition-all duration-300 hover:shadow-[0_0_24px_rgba(209,156,151,0.25)]"
            data-testid="cta-place-order"
          >
            <PenLine className="w-4 h-4" />
            Place an Order
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
          <Link
            to="/status"
            className="group inline-flex items-center gap-2 border border-border text-foreground hover:border-primary hover:text-primary px-8 py-4 rounded-full tracking-widest uppercase text-xs transition-all duration-300"
            data-testid="cta-order-status"
          >
            <Search className="w-4 h-4" />
            Track an Order
          </Link>
        </div>
      </div>

      {/* Footer whisper */}
      <div className="absolute bottom-6 inset-x-0 z-10 text-center">
        <p className="text-muted-foreground/50 text-xs tracking-[0.2em] uppercase font-light">
          Bespoke · Handcrafted · Made to measure
        </p>
      </div>
    </div>
  );
}
