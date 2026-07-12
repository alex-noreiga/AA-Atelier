import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Bell, Loader2, PenLine } from "lucide-react";
import {
  useGetProducts,
  type Product,
  type ProductVariant,
} from "@workspace/api-client-react";
import { PageShell } from "@/components/page-shell";
import { SizeChartDialog } from "@/components/size-chart-dialog";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ALL = "All";

function formatPrice(price?: number): string {
  return typeof price === "number" ? `$${price}` : "inquire for price";
}

function contactHref(variant: ProductVariant): string {
  const base = `/contact?item=${encodeURIComponent(variant.name)}`;
  return variant.available ? base : `${base}&notify=1`;
}

function testId(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Filter chips, derived from the categories actually present in the inventory.
 * The atelier team edits the "Item Type" select in Notion and new values must
 * appear without a redeploy — so never hardcode this list. Items with no
 * category are reachable only under "All".
 */
function categoriesOf(products: Product[]): string[] {
  const found = new Set(
    products.map((product) => product.category).filter(Boolean),
  );
  return [ALL, ...[...found].sort((a, b) => a.localeCompare(b))];
}

/** A single photo, the whole gallery, or a monogram placeholder. */
function VariantGallery({
  variant,
  carousel = false,
}: {
  variant: ProductVariant;
  carousel?: boolean;
}) {
  const monogram = (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-card via-background to-primary/20">
      <span className="font-serif text-4xl text-primary/40 tracking-[0.2em]">
        AA
      </span>
    </div>
  );

  if (variant.photos.length === 0) {
    return <AspectRatio ratio={3 / 4}>{monogram}</AspectRatio>;
  }

  if (!carousel || variant.photos.length === 1) {
    return (
      <AspectRatio ratio={3 / 4}>
        <img
          src={variant.photos[0]}
          alt={variant.name}
          className="h-full w-full object-cover"
        />
      </AspectRatio>
    );
  }

  return (
    <Carousel className="w-full">
      <CarouselContent>
        {variant.photos.map((photo, i) => (
          <CarouselItem key={`${photo}-${i}`}>
            <AspectRatio ratio={3 / 4}>
              <img
                src={photo}
                alt={`${variant.name} — photo ${i + 1}`}
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

function VariantChips({
  variants,
  selected,
  onSelect,
}: {
  variants: ProductVariant[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  if (variants.length <= 1) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {variants.map((variant, i) => (
        <button
          key={variant.id}
          type="button"
          onClick={() => onSelect(i)}
          aria-pressed={i === selected}
          className={cn(
            "rounded-full border px-3 py-1 text-xs transition-colors",
            i === selected
              ? "border-primary text-primary"
              : "border-border/60 text-muted-foreground hover:border-primary/50",
            !variant.available && "line-through opacity-60",
          )}
          data-testid={`variant-${variant.id}`}
        >
          {variant.name}
        </button>
      ))}
    </div>
  );
}

function CtaLink({ variant }: { variant: ProductVariant }) {
  if (variant.available) {
    return (
      <Link
        to={contactHref(variant)}
        className="group inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-xs uppercase tracking-widest text-foreground transition-all duration-300 hover:border-primary hover:text-primary"
        data-testid={`cta-inquire-${variant.id}`}
      >
        inquire
        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
      </Link>
    );
  }
  return (
    <Link
      to={contactHref(variant)}
      className="group inline-flex items-center gap-2 rounded-full border border-primary/40 px-6 py-3 text-xs uppercase tracking-widest text-primary transition-all duration-300 hover:border-primary"
      data-testid={`cta-notify-${variant.id}`}
    >
      <Bell className="w-3.5 h-3.5" />
      Notify me when back in stock
    </Link>
  );
}

function ProductCard({ product }: { product: Product }) {
  const [selected, setSelected] = useState(0);
  const variant = product.variants[selected] ?? product.variants[0];

  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl border border-border/60 transition-colors hover:border-primary/50"
      data-testid={`product-${product.id}`}
    >
      {/* Image opens the quick-view dialog */}
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className="relative block text-left"
            data-testid={`product-view-${product.id}`}
          >
            <VariantGallery variant={variant} />
            {!variant.available && (
              <span className="absolute top-3 left-3 rounded-full bg-background/70 px-3 py-1 text-[0.65rem] tracking-widest uppercase text-muted-foreground backdrop-blur-sm">
                Sold Out
              </span>
            )}
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="overflow-hidden rounded-xl border border-border/60">
              <VariantGallery variant={variant} carousel />
            </div>
            <div className="flex flex-col">
              <DialogHeader className="text-left">
                {product.category && (
                  <p className="text-primary text-xs tracking-[0.3em] uppercase mb-1">
                    {product.category}
                  </p>
                )}
                <DialogTitle className="font-serif text-3xl text-foreground">
                  {product.title}
                </DialogTitle>
                {variant.description && (
                  // Listing Notes are authored in Notion with line breaks and
                  // bullet lists — preserve them rather than collapsing to a blob.
                  <DialogDescription className="text-base text-muted-foreground font-light leading-relaxed mt-2 whitespace-pre-line">
                    {variant.description}
                  </DialogDescription>
                )}
              </DialogHeader>

              <p className="mt-5 font-serif text-2xl text-primary">
                {formatPrice(variant.price)}
              </p>

              <VariantChips
                variants={product.variants}
                selected={selected}
                onSelect={setSelected}
              />

              {!variant.available && (
                <p className="mt-4 text-sm text-muted-foreground">
                  <span className="text-foreground">{variant.name}</span> is
                  currently sold out.
                </p>
              )}

              <div className="mt-auto pt-6">
                <CtaLink variant={variant} />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Card body */}
      <div className="flex flex-1 flex-col p-6">
        <h2 className="font-serif text-2xl text-foreground">{product.title}</h2>
        <p className="mt-1 text-primary font-light">
          {formatPrice(variant.price)}
        </p>
        <VariantChips
          variants={product.variants}
          selected={selected}
          onSelect={setSelected}
        />
        {variant.description && (
          <p className="mt-4 text-sm text-muted-foreground font-light leading-relaxed line-clamp-3">
            {variant.description}
          </p>
        )}
        <div className="mt-6 pt-2">
          <CtaLink variant={variant} />
        </div>
      </div>
    </div>
  );
}

/**
 * The shop. Everything shown here is live inventory from the Notion "inventory"
 * database — there is no hardcoded catalogue. Loading, error, and empty all
 * still render the page chrome and the closing commission CTA.
 */
export default function Shop() {
  const [filter, setFilter] = useState<string>(ALL);
  const { data, isLoading, isError } = useGetProducts();

  const products = data?.products ?? [];
  const categories = categoriesOf(products);
  // A category can vanish between refetches (the team retires an Item Type);
  // fall back to "All" rather than stranding the user on a dead chip.
  const active = categories.includes(filter) ? filter : ALL;
  const visible =
    active === ALL
      ? products
      : products.filter((product) => product.category === active);

  return (
    <PageShell align="top">
      <div className="w-full max-w-6xl z-10 mx-auto px-6 pt-24 pb-20 animate-in fade-in zoom-in-95 duration-1000">
        {/* Header */}
        <div className="text-center">
          <p className="text-primary text-xs tracking-[0.35em] uppercase mb-8">
            A.A Atelier
          </p>
          <h1 className="text-5xl md:text-7xl font-serif text-foreground leading-[1.05] mb-8">
            The Shop
          </h1>
          <p className="text-muted-foreground font-light text-lg md:text-xl max-w-xl mx-auto leading-relaxed">
            Finished pieces{" "}
            <span className="italic text-primary">ready to ship</span>, alongside
            the small skate accessories we keep on hand.
          </p>
          <SizeChartDialog className="mt-8" />
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

        {/* Product grid */}
        {isLoading ? (
          <div className="mt-16 text-center" data-testid="shop-loading">
            <Loader2 className="w-6 h-6 text-primary/60 mx-auto animate-spin" />
          </div>
        ) : isError ? (
          <p
            className="mt-16 text-center text-muted-foreground font-light"
            data-testid="shop-error"
          >
            We couldn't load current stock just now. Please try again in a
            moment.
          </p>
        ) : visible.length === 0 ? (
          <p
            className="mt-16 text-center text-muted-foreground font-light"
            data-testid="shop-empty"
          >
            The shop is restocking. Commission something bespoke in the meantime.
          </p>
        ) : (
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}

        {/* Closing CTA */}
        <div className="mt-24 text-center">
          <p className="text-muted-foreground font-light text-lg mb-8">
            Don't see quite what you're looking for?
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/order"
              className="group inline-flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-4 rounded-full tracking-widest uppercase text-xs transition-all duration-300 hover:shadow-[0_0_24px_rgba(209,156,151,0.25)]"
              data-testid="cta-commission"
            >
              <PenLine className="w-4 h-4" />
              Commission Something Bespoke
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              to="/shop/status"
              className="group inline-flex items-center gap-2 border border-border text-foreground hover:border-primary hover:text-primary px-8 py-4 rounded-full tracking-widest uppercase text-xs transition-all duration-300"
              data-testid="link-order-status"
            >
              Track Your Order
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
