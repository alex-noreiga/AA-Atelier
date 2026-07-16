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

/** Default social-share image (absolute), used when a route sets no `image`. */
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/opengraph.jpg`;

export interface RouteSeo {
  /** Route path, e.g. "/" or "/about". Also the sitemap `loc` and canonical. */
  path: string;
  /** Full document title, e.g. "About A.A Atelier — Custom Skating Costume Studio". */
  title: string;
  /** Meta description — one to two sentences, keyword-aware. */
  description: string;
  /** Optional absolute og:image / twitter:image. Falls back to DEFAULT_OG_IMAGE. */
  image?: string;
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
    title: "Custom Figure Skating & Dance Costumes | A.A Atelier",
    description:
      "A.A Atelier crafts custom, made-to-measure figure skating and dance costumes by hand — from first sketch to final stitch. Begin a commission or track your order.",
    changefreq: "monthly",
    priority: 1.0,
  },
  "/services": {
    path: "/services",
    title: "Services — Bespoke Costumes, Fittings & Rhinestoning | A.A Atelier",
    description:
      "Bespoke commissions, in-person fittings and alterations, hand-applied rhinestoning, and repairs for figure skating and dance costumes by A.A Atelier.",
    changefreq: "monthly",
    priority: 0.8,
  },
  "/about": {
    path: "/about",
    title: "About A.A Atelier — Custom Skating Costume Studio",
    description:
      "Meet A.A Atelier, the custom figure skating and dance costume studio behind A3 Ice and Dance. Answers on timelines, measuring, pricing, rush orders, and shipping.",
    changefreq: "monthly",
    priority: 0.8,
  },
  "/shop": {
    path: "/shop",
    title: "Shop — Ready-to-Wear Skating & Dance | A.A Atelier",
    description:
      "Browse ready-to-wear figure skating and dance pieces from A.A Atelier. In-stock dresses and accessories, with restock notifications on sold-out sizes.",
    changefreq: "weekly",
    priority: 0.9,
  },
  "/order": {
    path: "/order",
    title: "Place a Custom Costume Order | A.A Atelier",
    description:
      "Start your custom figure skating or dance costume. Share your contact details, measurements, and design notes and A.A Atelier will craft a one-of-a-kind piece for you.",
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
      "Get in touch with A.A Atelier about a custom figure skating or dance costume, a fitting, or a question. Reach us by email or on Instagram at @a3iceanddance.",
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
  "/shop/status": {
    path: "/shop/status",
    title: "Track Your Order | A.A Atelier",
    description:
      "Look up your A.A Atelier commission by order number and follow its progress through each stage of the atelier.",
    noindex: true,
  },
  "/shop/success": {
    path: "/shop/success",
    title: "Order Confirmed | A.A Atelier",
    description:
      "Your A.A Atelier order is confirmed. Thank you for your purchase.",
    noindex: true,
  },
  "/shop/order-status": {
    path: "/shop/order-status",
    title: "Track Your Shop Order | A.A Atelier",
    description:
      "Look up your A.A Atelier shop order by its order number and follow its progress toward delivery.",
    noindex: true,
  },
};

/** Indexable routes, in declaration order — drives prerendering + the sitemap. */
export const INDEXABLE_ROUTES: RouteSeo[] = Object.values(ROUTE_SEO).filter(
  (r) => !r.noindex,
);
