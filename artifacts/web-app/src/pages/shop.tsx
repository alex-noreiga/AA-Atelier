import { useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { ArrowRight, Bell, Loader2, PenLine, Search } from "lucide-react";
import {
  useGetProducts,
  type Product,
  type ProductVariant,
} from "@workspace/api-client-react";
import { NotifyDialog } from "@/components/notify-dialog";
import { AddToCartButton } from "@/components/add-to-cart";
import { SizeSelector } from "@/components/size-selector";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/page-shell";
import { CtaLink } from "@/components/cta";
import { Seo, StructuredData, SITE_ORIGIN } from "@/components/seo";
import { ROUTE_SEO } from "@/lib/seo-routes";
import {
  breadcrumbJsonLd,
  productImages,
  productMetaDescription,
  productJsonLd,
  productTitle,
} from "@/lib/product-seo";
import { formatPrice } from "@/lib/format";
import { SizeChartDialog } from "@/components/size-chart-dialog";
import { StarRating } from "@/components/star-rating";
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

// At or below this countable stock level a card shows an "Only N left" nudge.
// A null/undefined count (one-off items) never triggers it.
const LOW_STOCK_THRESHOLD = 5;

// Whether a card shows a size guide at all. Decided server-side (`sized` on the
// Product) from the Notion "Product Categories" data, so the client no longer
// hardcodes which categories are sized — the atelier toggles it per category in
// Notion with no redeploy. Which chart shows (garment vs. soaker) is a separate
// server-resolved field, `product.sizeGuide`.
function hasSizeChart(product: Product): boolean {
  return product.sized;
}

/** An in-stock item invites an inquiry; a sold-out one opens the notify dialog. */
function contactHref(variant: ProductVariant): string {
  return `/contact?item=${encodeURIComponent(variant.name)}`;
}

/** Flatten every variant across all products into an id→variant lookup, so a
 * variant's `addOnIds` (which reference other variants in the same payload) can
 * be resolved to full records without the API sending them twice. */
export function indexVariants(
  products: Product[],
): Map<string, ProductVariant> {
  const byId = new Map<string, ProductVariant>();
  for (const product of products) {
    for (const variant of product.variants) byId.set(variant.id, variant);
  }
  return byId;
}

/** Resolve a variant's matching add-ons to buyable records: they must exist in
 * the payload, be in stock, and be priced (an unpriced/sold-out add-on can't be
 * dropped into the cart, so it's simply not offered). Pure, so it's unit-tested. */
export function resolveAddOns(
  variant: ProductVariant,
  byId: Map<string, ProductVariant>,
): ProductVariant[] {
  return (variant.addOnIds ?? [])
    .map((id) => byId.get(id))
    .filter(
      (v): v is ProductVariant =>
        !!v && v.available && typeof v.price === "number",
    );
}

function testId(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "-");
}

/** Case-insensitive match of a search query against the names shown on a
 * product's card — its title and each variant's name (colorways/styles) — so a
 * shopper can find a piece by anything it's called. An empty/whitespace query
 * matches everything. Pure, so it's unit-tested. */
export function matchesQuery(product: Product, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const haystack = [product.title, ...product.variants.map((v) => v.name)]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
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
                alt={`${variant.name}, photo ${i + 1}`}
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

/**
 * What buyers said about a piece, in the quick view: the rating, then a few
 * reviews in their own words.
 *
 * Renders nothing at all for a piece with no reviews — no empty state, no "be
 * the first to review". Most pieces will have none, and an invitation on every
 * card is a shop that looks unvisited.
 */
function ProductReviews({ product }: { product: Product }) {
  const rating = product.rating;
  if (!rating) return null;

  return (
    <div
      className="mt-6 border-t border-border/60 pt-5"
      data-testid={`product-reviews-${product.id}`}
    >
      <StarRating average={rating.average} count={rating.count} size="md" />
      {rating.reviews.length > 0 && (
        <ul className="mt-4 space-y-4">
          {rating.reviews.map((review) => (
            <li key={review.id} className="text-sm font-light">
              <p className="text-muted-foreground leading-relaxed">
                “{review.comment}”
              </p>
              {review.customerName && (
                <p className="mt-1 text-xs uppercase tracking-widest text-primary/70">
                  {review.customerName}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A subtle "Only N left" nudge for a low, countable stock level. */
function LowStockNote({ variant }: { variant: ProductVariant }) {
  const n = variant.quantityAvailable;
  if (
    !variant.available ||
    typeof n !== "number" ||
    n <= 0 ||
    n > LOW_STOCK_THRESHOLD
  ) {
    return null;
  }
  return (
    <p
      className="mb-3 text-xs uppercase tracking-widest text-primary/80"
      data-testid={`low-stock-${variant.id}`}
    >
      Only {n} left
    </p>
  );
}

function VariantCta({
  variant,
  size,
  addOns = [],
}: {
  variant: ProductVariant;
  size: string;
  /** Matching add-ons for this variant, resolved from the product list. */
  addOns?: ProductVariant[];
}) {
  if (variant.available) {
    // A priced, in-stock item can be bought; an unpriced one ("inquire for
    // price") still routes to an inquiry, since we can't charge for it.
    if (typeof variant.price === "number") {
      return <AddToCartButton variant={variant} size={size} addOns={addOns} />;
    }
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
    <NotifyDialog
      item={variant.name}
      trigger={(open) => (
        <button
          type="button"
          onClick={open}
          className="group inline-flex items-center gap-2 rounded-full border border-primary/40 px-6 py-3 text-xs uppercase tracking-widest text-primary transition-all duration-300 hover:border-primary"
          data-testid={`cta-notify-${variant.id}`}
        >
          <Bell className="w-3.5 h-3.5" />
          Notify me when back in stock
        </button>
      )}
    />
  );
}

function ProductCard({
  product,
  open,
  onOpenChange,
  variantsById,
}: {
  product: Product;
  /** Quick-view open state — driven by the `/shop/:productId` route. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All variants across the shop, for resolving each variant's add-ons. */
  variantsById: Map<string, ProductVariant>;
}) {
  const [selected, setSelected] = useState(0);
  // A size chosen on the card is shared with the quick-view dialog (both render
  // the body sub-tree), and drives Add-to-cart. Only an available, priced
  // variant is buyable — otherwise the sizes are display-only.
  const [size, setSize] = useState("");
  const variant = product.variants[selected] ?? product.variants[0];
  const selectable = variant.available && typeof variant.price === "number";
  // Matching add-ons follow the selected variant (color/style-specific), so a
  // pink soaker offers its pink towel. Recomputed per render — cheap map lookups.
  const addOns = resolveAddOns(variant, variantsById);

  // A size stocked in one variant may be absent in another, so clear the
  // selection when the customer switches variants.
  const selectVariant = (index: number) => {
    setSelected(index);
    setSize("");
  };

  return (
    <div
      className="group flex flex-col overflow-hidden rounded-2xl border border-border/60 transition-all duration-300 hover:border-primary/50 hover:shadow-[0_0_30px_hsl(var(--primary)/0.10)]"
      data-testid={`product-${product.id}`}
    >
      {/* Image opens the quick-view dialog; open state is URL-driven so a
          product can be deep-linked and shared (see the Shop component). */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="relative block overflow-hidden text-left"
            data-testid={`product-view-${product.id}`}
          >
            <div className="transition-transform duration-700 ease-out group-hover:scale-[1.03]">
              <VariantGallery variant={variant} />
            </div>
            {!variant.available && (
              <>
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-background/60 to-transparent"
                />
                <span className="absolute top-3 left-3 rounded-full bg-background/70 px-3 py-1 text-[0.65rem] tracking-widest uppercase text-muted-foreground backdrop-blur-sm">
                  Sold Out
                </span>
              </>
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
                  <p className="text-primary text-xs tracking-[0.35em] uppercase mb-1">
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

              {product.rating && (
                <StarRating
                  className="mt-2"
                  average={product.rating.average}
                  count={product.rating.count}
                />
              )}

              <VariantChips
                variants={product.variants}
                selected={selected}
                onSelect={selectVariant}
              />

              <SizeSelector
                variant={variant}
                selectedSize={size}
                onSelectSize={setSize}
                selectable={selectable}
              />
              {hasSizeChart(product) && (
                <SizeChartDialog
                  className="mt-3"
                  variant={
                    product.sizeGuide === "soaker" ? "soaker" : "garment"
                  }
                />
              )}

              {!variant.available && (
                <p className="mt-4 text-sm text-muted-foreground">
                  <span className="text-foreground">{variant.name}</span> is
                  currently sold out.
                </p>
              )}

              <div className="mt-auto pt-6">
                <LowStockNote variant={variant} />
                <VariantCta variant={variant} size={size} addOns={addOns} />
              </div>

              <ProductReviews product={product} />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Card body */}
      <div className="flex flex-1 flex-col p-6">
        {product.category && (
          <p className="text-primary/80 text-[0.65rem] tracking-[0.3em] uppercase mb-2">
            {product.category}
          </p>
        )}
        <h2 className="font-serif text-2xl leading-tight text-foreground">
          {product.title}
        </h2>
        <p className="mt-1.5 font-serif text-lg text-primary">
          {formatPrice(variant.price)}
        </p>
        {product.rating && (
          <StarRating
            className="mt-2"
            average={product.rating.average}
            count={product.rating.count}
          />
        )}
        <VariantChips
          variants={product.variants}
          selected={selected}
          onSelect={selectVariant}
        />
        {variant.description && (
          <p className="mt-4 text-sm text-muted-foreground font-light leading-relaxed line-clamp-3">
            {variant.description}
          </p>
        )}

        <SizeSelector
          variant={variant}
          selectedSize={size}
          onSelectSize={setSize}
          selectable={selectable}
        />
        {hasSizeChart(product) && (
          <SizeChartDialog
            className="mt-3"
            variant={product.sizeGuide === "soaker" ? "soaker" : "garment"}
          />
        )}

        <div className="mt-auto pt-6">
          <LowStockNote variant={variant} />
          <VariantCta variant={variant} size={size} addOns={addOns} />
        </div>
      </div>
    </div>
  );
}

/** Per-product page metadata + JSON-LD, shown while a product deep link is open. */
function ProductSeo({ product }: { product: Product }) {
  return (
    <>
      <Seo
        title={productTitle(product)}
        description={productMetaDescription(product)}
        path={`/shop/${product.id}`}
        images={productImages(product)}
      />
      <StructuredData data={productJsonLd(product)} />
      <StructuredData data={breadcrumbJsonLd(product)} />
    </>
  );
}

/**
 * The shop. Everything shown here is live inventory from the Notion "inventory"
 * database — there is no hardcoded catalogue. Loading, error, and empty all
 * still render the page chrome and the closing commission CTA.
 *
 * A `/shop/:productId` deep link opens that product's quick-view: the dialog's
 * open state is derived from the route param, and opening/closing a card
 * navigates so the URL is always shareable.
 */
export default function Shop() {
  const [filter, setFilter] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const params = useParams();
  const [, navigate] = useLocation();
  const { data, isLoading, isError } = useGetProducts();

  const products = data?.products ?? [];
  // Built from the full catalogue (not just the filtered view) so an add-on can
  // resolve even when its own category is filtered out of the grid.
  const variantsById = indexVariants(products);
  const activeProductId = params.productId;
  const activeProduct = activeProductId
    ? products.find((product) => product.id === activeProductId)
    : undefined;
  // The server reads these live from the "Item Type" options in Notion and drops
  // any with no stock — so editing the options there changes the chips here with
  // no redeploy. Never hardcode them.
  const categories = [ALL, ...(data?.categories ?? [])];
  // A category can vanish between refetches (the team retires an Item Type);
  // fall back to "All" rather than stranding the user on a dead chip.
  const active = categories.includes(filter) ? filter : ALL;
  // The grid is the catalogue narrowed by both the category chip and the search
  // box — a piece has to satisfy both to show.
  const visible = products.filter(
    (product) =>
      (active === ALL || product.category === active) &&
      matchesQuery(product, query),
  );

  return (
    <PageShell align="top">
      {activeProduct ? (
        <ProductSeo product={activeProduct} />
      ) : (
        <Seo {...ROUTE_SEO["/shop"]} />
      )}
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
            <span className="italic text-primary">ready to ship</span>,
            alongside the small accessories we keep on hand.
          </p>
        </div>

        {/* Search box — client-side filter over the loaded catalogue, matching a
            piece by name. Shown once there's more than one item to sift through. */}
        {!isLoading && !isError && products.length > 1 && (
          <div className="mt-14 mx-auto w-full max-w-sm">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search pieces by name"
                aria-label="Search the shop by name"
                data-testid="shop-search"
                className="h-11 rounded-full border-border/70 pl-11 pr-4 text-sm"
              />
            </div>
          </div>
        )}

        {/* Category filter — only meaningful once there's more than one category */}
        {categories.length > 2 && (
          <div
            className={cn(
              "flex flex-wrap items-center justify-center gap-3",
              products.length > 1 ? "mt-6" : "mt-14",
            )}
          >
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
        ) : products.length === 0 ? (
          <p
            className="mt-16 text-center text-muted-foreground font-light"
            data-testid="shop-empty"
          >
            The shop is restocking. Commission something bespoke in the
            meantime.
          </p>
        ) : visible.length === 0 ? (
          <p
            className="mt-16 text-center text-muted-foreground font-light"
            data-testid="shop-no-results"
          >
            No pieces match your search. Try a different term or clear the
            filters.
          </p>
        ) : (
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                open={product.id === activeProductId}
                onOpenChange={(next) =>
                  navigate(next ? `/shop/${product.id}` : "/shop")
                }
                variantsById={variantsById}
              />
            ))}
          </div>
        )}

        {/* Closing CTA */}
        <div className="mt-24 text-center">
          <p className="text-muted-foreground font-light text-lg mb-8">
            Don't see quite what you're looking for?
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <CtaLink to="/order" data-testid="cta-commission">
              <PenLine className="w-4 h-4" />
              Commission Something Bespoke
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </CtaLink>
            <CtaLink
              to="/track"
              variant="outline"
              data-testid="link-order-status"
            >
              Track Your Order
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </CtaLink>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
