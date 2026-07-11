import { PageShell } from "@/components/page-shell";

export default function Shop() {
  return (
    <PageShell>
      <div className="w-full max-w-2xl z-10 mx-auto text-center animate-in fade-in zoom-in-95 duration-1000">
        <p className="text-primary text-xs tracking-[0.35em] uppercase mb-8">
          Atelier
        </p>
        <h1 className="text-5xl md:text-7xl font-serif text-foreground leading-[1.05] mb-8">
          Shop
        </h1>
        <p className="text-muted-foreground font-light text-lg md:text-xl max-w-xl mx-auto leading-relaxed">
          <span className="italic text-primary">
            Our boutique is coming soon.
          </span>
        </p>
      </div>
    </PageShell>
  );
}
