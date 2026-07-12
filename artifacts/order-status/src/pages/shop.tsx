import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, PenLine } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { SizeChartDialog } from "@/components/size-chart-dialog";
import { InStockSection } from "@/components/in-stock-section";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Shared size scales, referenced by products below.
const READY_TO_WEAR_SIZES = [
  "Adult XS",
  "Adult S",
  "Adult M",
  "Adult L",
  "Adult XL",
  "Child XS",
  "Child S",
  "Child M",
  "Child L",
  "Child XL",
] as const; // follows Jalie pattern measurements — see <SizeChartDialog />
const SOAKER_SIZES = ["Adult", "Youth"] as const;

type Category = "Dresses" | "Practice Wear" | "Accessories";
type Status = "available" | "made-to-order" | "limited" | "sold-out";

interface Product {
  slug: string; // stable id, used in data-testid + ?item=
  name: string;
  category: Category;
  price: string; // display string
  sizes?: readonly string[]; // omitted for one-size items (cloths, scrunchies)
  status: Status;
  description: string;
  image?: string; // imported asset; undefined → placeholder monogram
}

// The catalogue. Edit this array to change what the boutique offers.
// Drop real photos in `src/assets/shop/`, import them, and set `image`.
const PRODUCTS: Product[] = [
  {
    slug: "aurora-competition-dress",
    name: "Aurora Competition Dress",
    category: "Dresses",
    price: "From $420",
    sizes: READY_TO_WEAR_SIZES,
    status: "made-to-order",
    description:
      "A flowing competition dress with an illusion bodice and a soft circular skirt that moves with every element. Hand-set crystals graduate from the shoulder into the skirt. Made to order in your size and colourway.",
  },
  {
    slug: "etoile-ballet-neck-dress",
    name: "Étoile Ballet-Neck Dress",
    category: "Dresses",
    price: "From $460",
    sizes: READY_TO_WEAR_SIZES,
    status: "limited",
    description:
      "An elegant ballet-neck dress with long mesh sleeves and a fitted velvet bodice. A limited seasonal design — a handful of colourways available before it retires.",
  },
  {
    slug: "everyday-practice-dress",
    name: "Everyday Practice Dress",
    category: "Practice Wear",
    price: "From $180",
    sizes: READY_TO_WEAR_SIZES,
    status: "made-to-order",
    description:
      "A hard-wearing practice dress in brushed spandex, cut for full range of motion through jumps and spins. Simple, comfortable, and made to your measurements.",
  },
  {
    slug: "wrap-practice-skirt",
    name: "Wrap Practice Skirt",
    category: "Practice Wear",
    price: "From $95",
    sizes: READY_TO_WEAR_SIZES,
    status: "made-to-order",
    description:
      "A lightweight wrap skirt that ties at the waist and floats on the ice — perfect over leggings for training. Made to order in a range of chiffon shades.",
  },
  {
    slug: "blade-soakers",
    name: "Blade Soakers",
    category: "Accessories",
    price: "$22",
    sizes: SOAKER_SIZES,
    status: "available",
    description:
      "Absorbent terry-lined soakers that wick moisture from your blades between sessions to prevent rust. Available in Adult and Youth sizes, in a rotating selection of prints.",
  },
  {
    slug: "microfibre-blade-cloth",
    name: "Microfibre Blade Cloth",
    category: "Accessories",
    price: "$14",
    status: "available",
    description:
      "A plush microfibre cloth for drying blades and boots after every skate. One size — keep one in your bag and one in your kit.",
  },
  {
    slug: "silk-hair-scrunchie",
    name: "Silk Hair Scrunchie",
    category: "Accessories",
    price: "$12",
    status: "available",
    description:
      "A gentle satin scrunchie that holds a competition bun without creasing your hair. Available in blush, champagne, black, and deep plum.",
  },
  {
    slug: "crystal-scrunchie-set",
    name: "Crystal Scrunchie Set",
    category: "Accessories",
    price: "$28",
    status: "sold-out",
    description:
      "A set of two hand-embellished scrunchies scattered with crystals to match your competition dress. Currently sold out — check back soon or enquire about a custom set.",
  },
];

/** Look up a product's display name by slug — used by the Contact page to
 *  prefill a reservation enquiry from `/contact?item=<slug>`. */
export function getProductName(slug: string): string | undefined {
  return PRODUCTS.find((product) => product.slug === slug)?.name;
}

const CATEGORIES = ["All", "Dresses", "Practice Wear", "Accessories"] as const;
type Filter = (typeof CATEGORIES)[number];

const STATUS_LABEL: Record<Status, string> = {
  available: "In stock",
  "made-to-order": "Made to order",
  limited: "Limited",
  "sold-out": "Sold out",
};

function isReadyToWear(product: Product): boolean {
  return product.category === "Dresses" || product.category === "Practice Wear";
}

/** Compact sizes hint for cards, e.g. "Adult & Child XS–XL" or "Adult / Youth". */
function sizesHint(product: Product): string | null {
  if (!product.sizes) return null;
  if (product.sizes === READY_TO_WEAR_SIZES) return "Adult & Child XS–XL";
  return product.sizes.join(" / ");
}

function ctaLabel(product: Product): string {
  if (product.status === "sold-out") return "Sold out";
  return product.category === "Accessories" ? "Enquire" : "Reserve";
}

/** Product photo, or a graceful monogram placeholder until real photos exist. */
function ProductImage({ product }: { product: Product }) {
  if (product.image) {
    return (
      <img
        src={product.image}
        alt={product.name}
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-card via-background to-primary/20">
      <span className="font-serif text-4xl text-primary/40 tracking-[0.2em]">
        AA
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={cn(
        "absolute top-3 left-3 rounded-full px-3 py-1 text-[0.65rem] tracking-widest uppercase backdrop-blur-sm",
        status === "sold-out"
          ? "bg-background/70 text-muted-foreground"
          : "bg-background/70 text-primary",
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function ReserveLink({ product }: { product: Product }) {
  const soldOut = product.status === "sold-out";
  if (soldOut) {
    return (
      <span
        className="inline-flex cursor-not-allowed items-center gap-2 rounded-full border border-border/60 px-6 py-3 text-xs uppercase tracking-widest text-muted-foreground/60"
        data-testid={`cta-${product.slug}`}
      >
        Sold out
      </span>
    );
  }
  return (
    <Link
      to={`/contact?item=${product.slug}`}
      className="group inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-xs uppercase tracking-widest text-foreground transition-all duration-300 hover:border-primary hover:text-primary"
      data-testid={`cta-${product.slug}`}
    >
      {ctaLabel(product)}
      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
    </Link>
  );
}

function ProductCard({ product }: { product: Product }) {
  const hint = sizesHint(product);
  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl border border-border/60 transition-colors hover:border-primary/50"
      data-testid={`product-${product.slug}`}
    >
      {/* Image opens the quick-view dialog */}
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className="relative block text-left"
            data-testid={`product-view-${product.slug}`}
          >
            <AspectRatio ratio={3 / 4}>
              <ProductImage product={product} />
            </AspectRatio>
            <StatusBadge status={product.status} />
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="overflow-hidden rounded-xl border border-border/60">
              <AspectRatio ratio={3 / 4}>
                <ProductImage product={product} />
              </AspectRatio>
            </div>
            <div className="flex flex-col">
              <DialogHeader className="text-left">
                <p className="text-primary text-xs tracking-[0.3em] uppercase mb-1">
                  {product.category}
                </p>
                <DialogTitle className="font-serif text-3xl text-foreground">
                  {product.name}
                </DialogTitle>
                <DialogDescription className="text-base text-muted-foreground font-light leading-relaxed mt-2">
                  {product.description}
                </DialogDescription>
              </DialogHeader>

              <p className="mt-5 font-serif text-2xl text-primary">
                {product.price}
              </p>

              {product.sizes && (
                <div className="mt-5">
                  <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                    Sizes
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {product.sizes.map((size) => (
                      <span
                        key={size}
                        className="rounded-full border border-border/60 px-3 py-1 text-xs text-muted-foreground"
                      >
                        {size}
                      </span>
                    ))}
                  </div>
                  {isReadyToWear(product) && (
                    <SizeChartDialog className="mt-3" />
                  )}
                </div>
              )}

              <div className="mt-auto pt-6">
                <ReserveLink product={product} />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Card body */}
      <div className="flex flex-1 flex-col p-6">
        <h2 className="font-serif text-2xl text-foreground">{product.name}</h2>
        <p className="mt-1 text-primary font-light">{product.price}</p>
        {hint && (
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              {hint}
            </span>
            {isReadyToWear(product) && <SizeChartDialog />}
          </div>
        )}
        <p className="mt-4 text-sm text-muted-foreground font-light leading-relaxed line-clamp-3">
          {product.description}
        </p>
        <div className="mt-6 pt-2">
          <ReserveLink product={product} />
        </div>
      </div>
    </div>
  );
}

export default function Shop() {
  const [filter, setFilter] = useState<Filter>("All");
  const products =
    filter === "All"
      ? PRODUCTS
      : PRODUCTS.filter((product) => product.category === filter);

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
            Ready-to-wear pieces{" "}
            <span className="italic text-primary">finished to your measure</span>
            , alongside the small skate accessories we keep on hand.
          </p>
        </div>

        {/* Category filter */}
        <div className="mt-14 flex flex-wrap items-center justify-center gap-3">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setFilter(category)}
              className={cn(
                "rounded-full px-5 py-2 text-xs uppercase tracking-widest transition-all duration-300",
                filter === category
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:border-primary hover:text-primary",
              )}
              data-testid={`filter-${category.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Product grid */}
        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard key={product.slug} product={product} />
          ))}
        </div>

        {/* Live inventory synced from Notion */}
        <InStockSection />

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
