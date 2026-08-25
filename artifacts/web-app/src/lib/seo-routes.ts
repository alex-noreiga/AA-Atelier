/**
 * Single source of truth for per-route SEO metadata.
 *
 * This is a **pure-data module** — no React, no browser globals — so it can be
 * imported from three places without drift:
 *
 *   1. The page components, which spread an entry into `<Seo {...ROUTE_SEO["/about"]} />`.
 *   2. The build-time prerender plugin (`vite.config.ts`), which bakes each
 *      indexable route's head tags into a static `dist/public/<route>/index.html`
 *      so non-JS crawlers and social scrapers get real per-route previews.
 *   3. The same plugin's `sitemap.xml` generator, which lists every indexable route.
 *
 * Because the component, the prerendered HTML, and the sitemap all read from
 * here, they cannot disagree. Add a route once, in one place.
 */

/** Canonical production origin — mirror of `SITE_ORIGIN` in `components/seo.tsx`. */
export const SITE_ORIGIN = "https://a3iceanddance.com";

/**
 * One social-share image, plus the structured properties that describe it.
 *
 * Per the Open Graph spec `og:image:width` / `:height` / `:alt` attach to the
 * `og:image` they FOLLOW, so an image and its dimensions travel together as one
 * unit — that is why this is an object rather than four parallel fields. Width
 * and height are optional: a remote image whose size we don't know (a Notion
 * product photo) must emit NO dimension tags rather than inherit another
 * image's, which would make scrapers lay out the card against a wrong aspect
 * ratio.
 */
export interface OgImage {
  /** Absolute URL — social scrapers do not resolve relative paths. */
  url: string;
  /** Pixel width. Omit when unknown; never guess. */
  width?: number;
  /** Pixel height. Omit when unknown; never guess. */
  height?: number;
  /** Accessible description of the image. */
  alt?: string;
}

const DEFAULT_OG_ALT =
  "Handcrafted custom skating and dance costumes by A.A Atelier";

/**
 * The two share formats every indexable route ships.
 *
 * They exist because the platforms disagree and only one image can be primary:
 * Facebook / LinkedIn / Slack / iMessage crop to landscape (1.91:1), while
 * Pinterest's feed is vertical (2:3) and shows a landscape image as a small
 * sliver. Emitting both as an ordered `og:image` pair costs nothing — a scraper
 * that only understands one image takes the first (landscape, unchanged from
 * before), and Pinterest can offer the tall one.
 *
 * Kept here rather than in the generator script so the metadata and the
 * artwork can't disagree about a file's dimensions.
 */
export const SOCIAL_IMAGE_SIZES = {
  og: { width: 1200, height: 630 },
  pin: { width: 1000, height: 1500 },
} as const;

/**
 * The filename stem for a route's generated artwork: "/" → "home",
 * "/shipping-returns" → "shipping-returns". Shared with
 * `scripts/generate-social-images.ts`, which writes the files.
 */
export function socialSlug(routePath: string): string {
  const trimmed = routePath.replace(/^\/|\/$/g, "");
  return trimmed === "" ? "home" : trimmed.replace(/\//g, "-");
}

/**
 * Alt text for a route's artwork, from its title.
 *
 * A page title is written for a search result and carries a brand suffix
 * ("… | A.A Atelier") that reads as noise when a screen reader announces an
 * image. Trim the suffix and name the studio once, as a description of the
 * card rather than a repeat of the headline.
 */
function socialAlt(title: string): string {
  const headline = title.split("|")[0]!.trim();
  return `${headline} from A.A Atelier`;
}

/** The generated landscape + vertical pair for a route, in preference order. */
export function socialImages(routePath: string, title: string): OgImage[] {
  const slug = socialSlug(routePath);
  const alt = socialAlt(title);
  return (["og", "pin"] as const).map((format) => ({
    url: `${SITE_ORIGIN}/social/${slug}-${format}.png`,
    ...SOCIAL_IMAGE_SIZES[format],
    alt,
  }));
}

/** Default landscape share image, used when a route has no artwork of its own. */
export const DEFAULT_OG_IMAGE: OgImage = {
  url: `${SITE_ORIGIN}/opengraph.jpg`,
  width: 1280,
  height: 720,
  alt: DEFAULT_OG_ALT,
};

/**
 * The fallback set: the home route's generated pair, with the legacy
 * `opengraph.jpg` kept last so a scraper still has something if the generated
 * art is ever missing from a deploy.
 */
export const DEFAULT_OG_IMAGES: OgImage[] = [
  ...socialImages("/", "Custom Skating & Dance Costumes"),
  DEFAULT_OG_IMAGE,
];

/**
 * The images a route shares, in order. The first is the primary card (what
 * Facebook, LinkedIn, Slack, and the Twitter card use); later entries are
 * alternates a scraper may offer as a choice.
 *
 * An explicit `images` wins (a product deep link passes its own photo); an
 * indexable route falls back to its generated pair; anything else — a noindex
 * route, the SPA catch-all — gets the shared default.
 */
export function imagesFor(route: {
  path?: string;
  title?: string;
  images?: OgImage[];
  noindex?: boolean;
}): OgImage[] {
  if (route.images && route.images.length > 0) return route.images;
  if (route.path && !route.noindex && ROUTE_SEO[route.path]) {
    return socialImages(route.path, route.title ?? DEFAULT_OG_ALT);
  }
  return DEFAULT_OG_IMAGES;
}

export interface RouteSeo {
  /** Route path, e.g. "/" or "/about". Also the sitemap `loc` and canonical. */
  path: string;
  /** Full document title, e.g. "About A.A Atelier: Custom Skating & Dance Costume Studio". */
  title: string;
  /** Meta description — one to two sentences, keyword-aware. */
  description: string;
  /**
   * Social share images in preference order. Falls back to `DEFAULT_OG_IMAGES`.
   * The first entry is the primary card.
   */
  images?: OgImage[];
  /** When true: robots noindex, excluded from the sitemap and from prerendering. */
  noindex?: boolean;
  /** Sitemap `changefreq` hint (indexable routes only). */
  changefreq?: string;
  /** Sitemap `priority` hint, 0.0–1.0 (indexable routes only). */
  priority?: number;
}

export const ROUTE_SEO: Record<string, RouteSeo> = {
  "/": {
    path: "/",
    title: "Custom Skating & Dance Costumes | A.A Atelier",
    description:
      "A.A Atelier crafts custom, made-to-measure costumes for figure skating and dance by hand, from first sketch to final stitch. Begin a commission or track your order.",
    changefreq: "monthly",
    priority: 1.0,
  },
  "/services": {
    path: "/services",
    title: "Services: Bespoke Costumes, Fittings & Rhinestoning | A.A Atelier",
    description:
      "Bespoke commissions, in-person fittings and alterations, hand-applied rhinestoning, and repairs for skating and dance costumes by A.A Atelier.",
    changefreq: "monthly",
    priority: 0.8,
  },
  "/about": {
    path: "/about",
    title: "About A.A Atelier: Custom Skating & Dance Costume Studio",
    description:
      "Meet A.A Atelier, the custom skating and dance costume studio behind A3 Ice and Dance. Answers on timelines, measuring, pricing, rush orders, and shipping.",
    changefreq: "monthly",
    priority: 0.8,
  },
  "/shop": {
    path: "/shop",
    title: "Shop Ready-to-Wear Skating & Dance | A.A Atelier",
    description:
      "Browse ready-to-wear skating and dance pieces from A.A Atelier. In-stock costumes and accessories, with restock notifications on sold-out sizes.",
    changefreq: "weekly",
    priority: 0.9,
  },
  "/portfolio": {
    path: "/portfolio",
    title: "Portfolio — Finished Skating & Dance Costumes | A.A Atelier",
    description:
      "A gallery of finished figure skating and dance costumes by A.A Atelier, and the sketches they began as. Filter by discipline, colorway, or competition.",
    changefreq: "weekly",
    priority: 0.8,
  },
  "/order": {
    path: "/order",
    title: "Place a Custom Costume Order | A.A Atelier",
    description:
      "Start your custom skating or dance costume. Share your contact details, measurements, and design notes and A.A Atelier will craft a one-of-a-kind piece for you.",
    changefreq: "monthly",
    priority: 0.7,
  },
  "/appointments": {
    path: "/appointments",
    title: "Book an Appointment | A.A Atelier",
    description:
      "Schedule a consultation, fitting, or design review with A.A Atelier. Pick a time that works for you and book online in a few steps.",
    changefreq: "monthly",
    priority: 0.7,
  },
  "/contact": {
    path: "/contact",
    title: "Contact A.A Atelier | A3 Ice and Dance",
    description:
      "Get in touch with A.A Atelier about a custom skating or dance costume, a fitting, or a question. Reach us by email or on Instagram at @a3iceanddance.",
    changefreq: "monthly",
    priority: 0.6,
  },
  "/privacy": {
    path: "/privacy",
    title: "Privacy Policy | A.A Atelier",
    description:
      "How A.A Atelier collects, uses, and protects your personal information, including contact details, measurements, and payment data.",
    changefreq: "yearly",
    priority: 0.3,
  },
  "/terms": {
    path: "/terms",
    title: "Terms of Service | A.A Atelier",
    description:
      "The terms governing your use of the A.A Atelier website, custom orders, deposits, appointments, and shop purchases.",
    changefreq: "yearly",
    priority: 0.3,
  },
  "/shipping-returns": {
    path: "/shipping-returns",
    title: "Shipping & Returns | A.A Atelier",
    description:
      "A.A Atelier's shipping timelines and return policy, including why custom, made-to-measure garments are final sale.",
    changefreq: "yearly",
    priority: 0.3,
  },

  // ── Noindex routes — carry per-route titles but are kept out of the sitemap
  //    and out of prerendering (they render behind dynamic, per-visitor state).
  "/track": {
    path: "/track",
    title: "Track Your Order | A.A Atelier",
    description:
      "Look up any A.A Atelier order, a custom commission or a shop purchase, by its order number and follow its progress.",
    noindex: true,
  },
  "/shop/success": {
    path: "/shop/success",
    title: "Order Confirmed | A.A Atelier",
    description:
      "Your A.A Atelier order is confirmed. Thank you for your purchase.",
    noindex: true,
  },
  "/account/login": {
    path: "/account/login",
    title: "Sign In | A.A Atelier",
    description:
      "Sign in to your A.A Atelier account to see your orders and invoices in one place.",
    noindex: true,
  },
  "/account/callback": {
    path: "/account/callback",
    title: "Signing In… | A.A Atelier",
    description: "Completing your A.A Atelier sign-in.",
    noindex: true,
  },
  "/account/reset": {
    path: "/account/reset",
    title: "Set a New Password | A.A Atelier",
    description: "Choose a new password for your A.A Atelier account.",
    noindex: true,
  },
  "/account": {
    path: "/account",
    title: "Your Account | A.A Atelier",
    description:
      "Your A.A Atelier account: custom orders, shop orders, and invoices gathered in one place.",
    noindex: true,
  },
  // Internal, staff-only. Noindex keeps it out of the sitemap and the prerender
  // pass as well as out of search results — the gate is server-side, but there's
  // no reason to advertise the page at all.
  "/studio": {
    path: "/studio",
    title: "Dashboard | A.A Atelier",
    description: "Internal studio dashboard.",
    noindex: true,
  },
};

/** Indexable routes, in declaration order — drives prerendering + the sitemap. */
export const INDEXABLE_ROUTES: RouteSeo[] = Object.values(ROUTE_SEO).filter(
  (r) => !r.noindex,
);
