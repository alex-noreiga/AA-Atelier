import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Bell, Loader2 } from "lucide-react";
import {
  useGetProducts,
  type Product,
  type ProductVariant,
} from "@workspace/api-client-react";
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

function formatPrice(price?: number): string {
  return typeof price === "number" ? `$${price}` : "Enquire for price";
}

function contactHref(variant: ProductVariant): string {
  const base = `/contact?item=${encodeURIComponent(variant.name)}`;
  return variant.available ? base : `${base}&notify=1`;
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
        data-testid={`cta-enquire-${variant.id}`}
      >
        Enquire
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

function InventoryCard({ product }: { product: Product }) {
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
                  <DialogDescription className="text-base text-muted-foreground font-light leading-relaxed mt-2">
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
        <h3 className="font-serif text-2xl text-foreground">{product.title}</h3>
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
 * Live "Ready to Ship" section, synced from the Notion inventory database.
 * Hidden entirely when nothing is published; never breaks the page on error.
 */
export function InStockSection() {
  const { data, isLoading, isError } = useGetProducts();
  const products = data?.products ?? [];

  if (isLoading) {
    return (
      <div className="mt-24 text-center">
        <Loader2 className="w-6 h-6 text-primary/60 mx-auto animate-spin" />
      </div>
    );
  }

  // Never break the page — the curated catalogue above still renders.
  if (isError) {
    return (
      <p className="mt-24 text-center text-sm text-muted-foreground/70 font-light">
        We couldn't load current stock just now.
      </p>
    );
  }

  if (products.length === 0) return null;

  return (
    <section className="mt-24">
      <div className="text-center mb-12">
        <p className="text-primary text-xs tracking-[0.35em] uppercase mb-4">
          Ready to Ship
        </p>
        <h2 className="font-serif text-3xl md:text-4xl text-foreground">
          In stock now
        </h2>
      </div>
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <InventoryCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
