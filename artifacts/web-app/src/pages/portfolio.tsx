import { useState } from "react";
import { ArrowRight, Loader2, PenLine } from "lucide-react";
import {
  useGetPortfolio,
  type PortfolioItem,
} from "@workspace/api-client-react";
import { PageShell } from "@/components/page-shell";
import { CtaLink } from "@/components/cta";
import { Seo } from "@/components/seo";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

const ALL = "All";

function testId(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "-");
}

/** A single photo, the whole gallery, or a monogram placeholder. */
function ItemGallery({ item }: { item: PortfolioItem }) {
  const monogram = (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-card via-background to-primary/20">
      <span className="font-serif text-4xl text-primary/40 tracking-[0.2em]">
        AA
      </span>
    </div>
  );

  if (item.photos.length === 0) {
    return <AspectRatio ratio={3 / 4}>{monogram}</AspectRatio>;
  }

  if (item.photos.length === 1) {
    return (
      <AspectRatio ratio={3 / 4}>
        <img
          src={item.photos[0]}
          alt={item.title}
          className="h-full w-full object-cover rounded-xl"
        />
      </AspectRatio>
    );
  }

  return (
    <Carousel className="w-full">
      <CarouselContent>
        {item.photos.map((photo, i) => (
          <CarouselItem key={`${photo}-${i}`}>
            <AspectRatio ratio={3 / 4}>
              <img
                src={photo}
                alt={`${item.title} — photo ${i + 1}`}
                className="h-full w-full object-cover rounded-xl"
              />
            </AspectRatio>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious className="left-2" />
      <CarouselNext className="right-2" />
    </Carousel>
  );
}

function PortfolioCard({ item }: { item: PortfolioItem }) {
  return (
    <figure
      className="group flex flex-col gap-4"
      data-testid={`portfolio-item-${item.id}`}
    >
      <div className="overflow-hidden rounded-xl border border-border/60">
        <ItemGallery item={item} />
      </div>
      <figcaption>
        <h3 className="font-serif text-lg text-foreground">{item.title}</h3>
        {item.caption && (
          <p className="mt-1 text-sm text-muted-foreground font-light leading-relaxed">
            {item.caption}
          </p>
        )}
      </figcaption>
    </figure>
  );
}

/**
 * The portfolio / gallery. Everything shown here is live from the Notion
 * "Portfolio" database — there is no hardcoded gallery. Loading, error, and
 * empty all still render the page chrome and the closing commission CTA.
 */
export default function Portfolio() {
  const [filter, setFilter] = useState<string>(ALL);
  const { data, isLoading, isError } = useGetPortfolio();

  const items = data?.items ?? [];
  // Read live from the "Category" options in Notion (narrowed to used ones), so
  // editing the options there changes the chips here with no redeploy.
  const categories = [ALL, ...(data?.categories ?? [])];
  const active = categories.includes(filter) ? filter : ALL;
  const visible =
    active === ALL
      ? items
      : items.filter((item) => item.category === active);

  return (
    <PageShell align="top">
      <Seo {...ROUTE_SEO["/portfolio"]} />
      <div className="w-full max-w-6xl z-10 mx-auto px-6 pt-24 pb-20 animate-in fade-in zoom-in-95 duration-1000">
        {/* Header */}
        <div className="text-center">
          <p className="text-primary text-xs tracking-[0.35em] uppercase mb-8">
            A.A Atelier
          </p>
          <h1 className="text-5xl md:text-7xl font-serif text-foreground leading-[1.05] mb-8">
            Portfolio
          </h1>
          <p className="text-muted-foreground font-light text-lg md:text-xl max-w-xl mx-auto leading-relaxed">
            A selection of custom pieces we've brought to life —{" "}
            <span className="italic text-primary">made just for them</span>.
          </p>
        </div>

        {/* Category filter — only meaningful once there's more than one category */}
        {categories.length > 2 && (
          <div className="mt-14 flex flex-wrap items-center justify-center gap-3">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setFilter(category)}
                className={cn(
                  "rounded-full px-5 py-2 text-xs uppercase tracking-widest transition-all duration-300",
                  active === category
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:border-primary hover:text-primary",
                )}
                data-testid={`filter-${testId(category)}`}
              >
                {category}
              </button>
            ))}
          </div>
        )}

        {/* Gallery grid */}
        {isLoading ? (
          <div className="mt-16 text-center" data-testid="portfolio-loading">
            <Loader2 className="w-6 h-6 text-primary/60 mx-auto animate-spin" />
          </div>
        ) : isError ? (
          <p
            className="mt-16 text-center text-muted-foreground font-light"
            data-testid="portfolio-error"
          >
            We couldn't load the gallery just now. Please try again in a moment.
          </p>
        ) : visible.length === 0 ? (
          <p
            className="mt-16 text-center text-muted-foreground font-light"
            data-testid="portfolio-empty"
          >
            Our gallery is being updated. Commission something bespoke in the
            meantime.
          </p>
        ) : (
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((item) => (
              <PortfolioCard key={item.id} item={item} />
            ))}
          </div>
        )}

        {/* Closing CTA */}
        <div className="mt-24 text-center">
          <p className="text-muted-foreground font-light text-lg mb-8">
            Ready to create something of your own?
          </p>
          <CtaLink to="/order" data-testid="cta-commission">
            <PenLine className="w-4 h-4" />
            Commission Something Bespoke
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </CtaLink>
        </div>
      </div>
    </PageShell>
  );
}
