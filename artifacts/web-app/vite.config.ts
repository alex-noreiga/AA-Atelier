import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "path";
import type { Product } from "@workspace/api-client-react";
import { INDEXABLE_ROUTES, type RouteSeo } from "./src/lib/seo-routes";
import {
  breadcrumbJsonLd,
  productImages,
  productJsonLd,
  productMetaDescription,
  productTitle,
} from "./src/lib/product-seo";
import {
  pinterestVerifyTag,
  renderRouteHtml,
  renderSitemap,
  type SitemapEntry,
} from "./src/lib/seo-html";

const port = process.env.PORT ? Number(process.env.PORT) : 5173;
const basePath = process.env.BASE_PATH ?? "/";

/**
 * Inject the Pinterest domain-claim tag from `PINTEREST_DOMAIN_VERIFY`.
 *
 * It runs as an `index.html` transform rather than being written into the file
 * so the token stays out of version control, and so an unset var leaves the
 * markup byte-identical to before. Because `seo-prerender` reads the *built*
 * index.html as its template, the tag propagates to every prerendered route for
 * free — Pinterest only checks the site root, but a claim tag on each page is
 * harmless and keeps the pages uniform.
 *
 * Deliberately not `VITE_`-prefixed: it is consumed here at build time and
 * never reaches the client bundle.
 */
function pinterestDomainVerify(): Plugin {
  return {
    name: "pinterest-domain-verify",
    transformIndexHtml() {
      return pinterestVerifyTag(process.env.PINTEREST_DOMAIN_VERIFY);
    },
  };
}

/**
 * The catalogue snapshot written by the api-server's `seo:export-products`.
 * Absent whenever Notion isn't configured for the build, which is the normal
 * case locally — product prerendering is then simply skipped.
 */
const PRODUCT_SEO_FILE = path.resolve(
  import.meta.dirname,
  ".seo/products.json",
);

/** Ids that are safe to use as a directory name, so catalogue data can't escape outDir. */
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

/**
 * Read the catalogue snapshot, or an empty list when there isn't one. The file
 * is verbatim the `GET /api/products` response, so it is typed against the
 * generated contract — a shape change in the API surfaces here as a type error
 * rather than as silently wrong share cards.
 */
function readExportedProducts(log: (msg: string) => void): Product[] {
  if (!fs.existsSync(PRODUCT_SEO_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(PRODUCT_SEO_FILE, "utf8"));
    const products: Product[] = parsed?.products ?? [];
    const safe = products.filter((p) => p?.id && SAFE_ID.test(p.id));
    if (safe.length !== products.length) {
      log(
        `seo-prerender: skipped ${products.length - safe.length} product(s) with an unsafe id`,
      );
    }
    return safe;
  } catch (err) {
    // A malformed snapshot must not fail the whole site build — degrade to the
    // pre-existing behaviour (product URLs fall through to the SPA).
    log(`seo-prerender: ignoring unreadable ${PRODUCT_SEO_FILE}: ${err}`);
    return [];
  }
}

/**
 * Build-time SEO prerendering.
 *
 * This is a client-rendered SPA, so the runtime `<Seo>` component only reaches
 * JS-executing crawlers. After the bundle is written, this plugin bakes each
 * indexable route's head tags into a static `dist/public/<route>/index.html`,
 * and regenerates `sitemap.xml` — both from the single `INDEXABLE_ROUTES`
 * source of truth. Non-JS crawlers and social scrapers (Facebook, LinkedIn,
 * Slack, iMessage) then get real per-route titles/descriptions/OG cards.
 *
 * On Vercel, `rewrites` are applied only after the built filesystem is checked,
 * so these static files are served directly at their clean paths; the SPA
 * catch-all remains the fallback for dynamic/noindex routes.
 */
function seoPrerender(): Plugin {
  return {
    name: "seo-prerender",
    apply: "build",
    closeBundle() {
      const outDir = path.resolve(import.meta.dirname, "dist/public");
      const indexPath = path.join(outDir, "index.html");
      if (!fs.existsSync(indexPath)) return;

      const template = fs.readFileSync(indexPath, "utf8");
      const buildDate = new Date().toISOString().slice(0, 10);

      for (const route of INDEXABLE_ROUTES) {
        const html = renderRouteHtml(template, route);
        if (route.path === "/") {
          fs.writeFileSync(indexPath, html);
        } else {
          const dir = path.join(outDir, route.path.replace(/^\//, ""));
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, "index.html"), html);
        }
      }

      // Product deep links are dynamic, so they can't live in seo-routes.ts.
      // Bake a page per product from the catalogue snapshot instead: without
      // one, a scraper hitting /shop/<id> falls through Vercel's SPA rewrite to
      // the home page and pins the wrong card entirely.
      const products = readExportedProducts((m) => this.warn(m));
      const productEntries: SitemapEntry[] = [];
      for (const product of products) {
        const route: RouteSeo = {
          path: `/shop/${product.id}`,
          title: productTitle(product),
          description: productMetaDescription(product),
          images: productImages(product),
        };
        const html = renderRouteHtml(template, route, [
          productJsonLd(product),
          breadcrumbJsonLd(product),
        ]);
        const dir = path.join(outDir, "shop", product.id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "index.html"), html);
        productEntries.push({
          path: route.path,
          changefreq: "weekly",
          priority: 0.6,
        });
      }

      fs.writeFileSync(
        path.join(outDir, "sitemap.xml"),
        renderSitemap([...INDEXABLE_ROUTES, ...productEntries], buildDate),
      );
      this.info(
        `seo-prerender: wrote ${INDEXABLE_ROUTES.length} route(s) + ` +
          `${products.length} product page(s) + sitemap.xml`,
      );
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss(), pinterestDomainVerify(), seoPrerender()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split large, rarely-changing vendor code into its own chunks so the
        // main app chunk stays small and browsers can cache vendors across
        // deploys. Keeps the build under the 500 kB per-chunk warning.
        manualChunks(id) {
          // Vite's dynamic-import preload helper and Rollup's CommonJS-interop
          // helpers are imported by both eager and async code. Pin them to the
          // eager `vendor` chunk so they never anchor an otherwise-async chunk
          // (pdf-vendor) into the initial load — the entry statically imports
          // the preload helper for every code-split page.
          if (id.includes("preload-helper") || id.includes("commonjsHelpers"))
            return "vendor";
          if (!id.includes("node_modules")) return;
          // The PDF export path (jsPDF + its transitive deps — core-js is the
          // heavy one) is only ever reached through a dynamic import on the
          // invoice / shop-success pages. Give it its own chunk so it stays
          // async and never weighs down the initial load: left to fall through
          // to `vendor` (which eager code needs) it would be pulled in eagerly.
          if (
            /[\\/]node_modules[\\/](jspdf|canvg|core-js|fflate|fast-png|rgbcolor|stackblur-canvas|raphael|@babel[\\/]runtime)[\\/]/.test(
              id,
            )
          )
            return "pdf-vendor";
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id))
            return "react-vendor";
          if (id.includes("@radix-ui")) return "radix-vendor";
          return "vendor";
        },
      },
    },
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
