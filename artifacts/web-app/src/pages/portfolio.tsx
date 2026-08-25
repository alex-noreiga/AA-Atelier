import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  useGetPortfolio,
  type PortfolioPiece,
  type PortfolioFilter,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** The "no filter applied" chip, per dimension. Never a value the server can
 * send — options come off published pieces, and a piece can't be filed under
 * "All". */
const ALL = "All";

const testId = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** A piece's values for one dimension, or an empty list when it has none. */
function valuesFor(piece: PortfolioPiece, facetId: string): string[] {
  return piece.facets.find((facet) => facet.id === facetId)?.values ?? [];
}

/**
 * Whether a piece survives the current selection.
 *
 * Dimensions are ANDed and values within a dimension are ORed — the ordinary
 * faceted-search reading, and the one the chips imply: picking Ice Dance *and*
 * Emerald asks for a piece that is both, while a piece filed under two
 * disciplines matches either chip.
 */
function matchesSelection(
  piece: PortfolioPiece,
  selection: Record<string, string>,
): boolean {
  return Object.entries(selection).every(
    ([facetId, value]) =>
      value === ALL || valuesFor(piece, facetId).includes(value),
  );
}

/** The caption under a card: everything the piece is filed under, in the
 * server's facet order, deduped across dimensions so a piece tagged "Emerald"
 * as both a colorway and a competition doesn't say so twice. */
function captionFor(piece: PortfolioPiece): string[] {
  const seen = new Set<string>();
  for (const facet of piece.facets) {
    for (const value of facet.values) seen.add(value);
  }
  return [...seen];
}

/** The cover, or a monogram placeholder — matching the shop's empty tile. A
 * published piece always has at least one image, so the placeholder only ever
 * stands in for a signed URL that expired mid-session. */
function PieceCover({ piece }: { piece: PortfolioPiece }) {
  const cover = piece.images[0];

  return (
    <AspectRatio ratio={3 / 4}>
      {cover ? (
        <img
          src={cover}
          alt={piece.title || "A piece from the A.A Atelier portfolio"}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-card via-background to-primary/20">
          <span className="font-serif text-4xl tracking-[0.2em] text-primary/40">
            AA
          </span>
        </div>
      )}
    </AspectRatio>
  );
}

/** Every image on a piece, as a carousel when there is more than one. */
function PieceGallery({ piece }: { piece: PortfolioPiece }) {
  const label = piece.title || "Portfolio piece";

  if (piece.images.length <= 1) {
    return (
      <div className="overflow-hidden rounded-xl border border-border/60">
        <PieceCover piece={piece} />
      </div>
    );
  }

  return (
    <Carousel className="w-full">
      <CarouselContent>
        {piece.images.map((image, index) => (
          <CarouselItem key={`${image}-${index}`}>
            <AspectRatio ratio={3 / 4}>
              <img
                src={image}
                alt={`${label} — image ${index + 1}`}
                className="h-full w-full rounded-xl object-cover"
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

function PieceCard({ piece }: { piece: PortfolioPiece }) {
  const caption = captionFor(piece);

  return (
    <Dialog>
      <div
        className="group overflow-hidden rounded-2xl border border-border/60 bg-card/40"
        data-testid="portfolio-piece"
      >
        <DialogTrigger asChild>
          <button
            type="button"
            className="block w-full overflow-hidden text-left"
            data-testid={`portfolio-view-${piece.id}`}
          >
            <div className="transition-transform duration-700 ease-out group-hover:scale-[1.03]">
              <PieceCover piece={piece} />
            </div>
          </button>
        </DialogTrigger>

        <div className="p-6">
          {piece.title && (
            <h2 className="font-serif text-2xl leading-tight text-foreground">
              {piece.title}
            </h2>
          )}
          {caption.length > 0 && (
            <p className="mt-2 text-[0.65rem] uppercase tracking-[0.3em] text-primary/80">
              {caption.join(" · ")}
            </p>
          )}
        </div>
      </div>

      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader className="text-left">
          <DialogTitle className="font-serif text-3xl text-foreground">
            {piece.title || "From the portfolio"}
          </DialogTitle>
        </DialogHeader>
        <PieceGallery piece={piece} />
        {caption.length > 0 && (
          <p className="text-xs uppercase tracking-[0.3em] text-primary/80">
            {caption.join(" · ")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One dimension's chip row. The options are the server's, derived from the
 * published pieces — never hardcoded here. */
function FilterRow({
  filter,
  active,
  onSelect,
}: {
  filter: PortfolioFilter;
  active: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <span className="text-[0.65rem] uppercase tracking-[0.3em] text-muted-foreground/70">
        {filter.label}
      </span>
      {[ALL, ...filter.options].map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onSelect(option)}
          className={cn(
            "rounded-full px-5 py-2 text-xs uppercase tracking-widest transition-all duration-300",
            active === option
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground hover:border-primary hover:text-primary",
          )}
          data-testid={`portfolio-filter-${testId(filter.id)}-${testId(option)}`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/**
 * The public portfolio gallery.
 *
 * Everything about *what* is shown is decided server-side — the publish gate on
 * each Notion row, and which chip groups the published work actually varies
 * along. This page renders what it is given: it never hardcodes a filter
 * option, and it never assumes a dimension exists.
 */
export default function Portfolio() {
  const [selection, setSelection] = useState<Record<string, string>>({});
  const { data, isLoading, isError } = useGetPortfolio();

  const pieces = data?.pieces ?? [];
  const filters = data?.filters ?? [];

  // A dimension — or one of its options — can vanish between refetches when the
  // atelier unpublishes the last piece carrying it. Reading the active value
  // through the server's current options rather than trusting local state is
  // what stops a visitor being stranded on a chip that no longer exists,
  // filtering the grid to nothing with no way back.
  const activeFor = (filter: PortfolioFilter): string => {
    const chosen = selection[filter.id];
    return chosen && filter.options.includes(chosen) ? chosen : ALL;
  };
  const liveSelection = Object.fromEntries(
    filters.map((filter) => [filter.id, activeFor(filter)]),
  );

  const visible = pieces.filter((piece) =>
    matchesSelection(piece, liveSelection),
  );

  return (
    <PageShell align="top">
      <Seo {...ROUTE_SEO["/portfolio"]} />
      <div className="z-10 mx-auto w-full max-w-6xl px-6 pt-24 pb-20 duration-1000 animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="text-center">
          <p className="mb-8 text-xs uppercase tracking-[0.35em] text-primary">
            A.A Atelier
          </p>
          <h1 className="mb-8 font-serif text-5xl leading-[1.05] text-foreground md:text-7xl">
            The Portfolio
          </h1>
          <p className="mx-auto max-w-xl text-lg font-light leading-relaxed text-muted-foreground md:text-xl">
            Finished costumes and the{" "}
            <span className="italic text-primary">sketches</span> they began as.
          </p>
        </div>

        {/* Filters — only the dimensions the published work actually varies
            along, each with its own chip row. */}
        {!isLoading && !isError && filters.length > 0 && (
          <div className="mt-14 space-y-4">
            {filters.map((filter) => (
              <FilterRow
                key={filter.id}
                filter={filter}
                active={activeFor(filter)}
                onSelect={(value) =>
                  setSelection((current) => ({
                    ...current,
                    [filter.id]: value,
                  }))
                }
              />
            ))}
          </div>
        )}

        {/* Gallery */}
        {isLoading ? (
          <div className="mt-16 text-center" data-testid="portfolio-loading">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary/60" />
          </div>
        ) : isError ? (
          <p
            className="mt-16 text-center font-light text-muted-foreground"
            data-testid="portfolio-error"
          >
            We couldn't load the portfolio just now. Please try again in a
            moment.
          </p>
        ) : pieces.length === 0 ? (
          <p
            className="mt-16 text-center font-light text-muted-foreground"
            data-testid="portfolio-empty"
          >
            The portfolio is being photographed. In the meantime, browse what's
            ready to wear in the shop — or begin a commission of your own.
          </p>
        ) : visible.length === 0 ? (
          <p
            className="mt-16 text-center font-light text-muted-foreground"
            data-testid="portfolio-no-results"
          >
            No pieces match those filters. Try clearing one.
          </p>
        ) : (
          <div
            className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="portfolio-grid"
          >
            {visible.map((piece) => (
              <PieceCard key={piece.id} piece={piece} />
            ))}
          </div>
        )}

        {/* Every gallery is an advertisement for the next commission. */}
        <div className="mt-20 text-center">
          <p className="mb-6 font-light text-muted-foreground">
            Picturing something of your own?
          </p>
          <CtaLink to="/order">Begin a commission</CtaLink>
        </div>
      </div>
    </PageShell>
  );
}
