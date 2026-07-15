import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "path";
import {
  INDEXABLE_ROUTES,
  SITE_ORIGIN,
  DEFAULT_OG_IMAGE,
  type RouteSeo,
} from "./src/lib/seo-routes";

const port = process.env.PORT ? Number(process.env.PORT) : 5173;
const basePath = process.env.BASE_PATH ?? "/";

/** HTML text-node escaping (for the <title> element). */
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Attribute-value escaping (for meta/link content/href). */
function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** Absolute canonical URL for a route — mirrors the logic in components/seo.tsx. */
function canonicalFor(routePath: string) {
  return (
    SITE_ORIGIN +
    (routePath === "/" ? "/" : `/${routePath.replace(/^\/|\/$/g, "")}`)
  );
}

/**
 * Rewrite the head of the built `index.html` template for a single route:
 * title, description, canonical, og/twitter title/description/url/image, robots.
 * Every other tag (Organization JSON-LD, image dimensions, fonts, manifest) is
 * left untouched. `[^>]` matches newlines, so this handles the multi-line meta
 * tags in index.html without a DOM parser.
 */
function renderRouteHtml(template: string, route: RouteSeo): string {
  const canonical = canonicalFor(route.path);
  const image = route.image ?? DEFAULT_OG_IMAGE;
  let html = template.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${escapeHtml(route.title)}</title>`,
  );

  const setMeta = (attr: string, value: string) => {
    const re = new RegExp(`(<meta[^>]*${attr}[^>]*content=")[^"]*(")`);
    html = html.replace(re, `$1${escapeAttr(value)}$2`);
  };

  setMeta('name="description"', route.description);
  setMeta('property="og:title"', route.title);
  setMeta('property="og:description"', route.description);
  setMeta('property="og:url"', canonical);
  setMeta('property="og:image"', image);
  setMeta('name="twitter:title"', route.title);
  setMeta('name="twitter:description"', route.description);
  setMeta('name="twitter:image"', image);
  setMeta('name="robots"', "index, follow");

  html = html.replace(
    /(<link[^>]*rel="canonical"[^>]*href=")[^"]*(")/,
    `$1${escapeAttr(canonical)}$2`,
  );
  return html;
}

function renderSitemap(buildDate: string): string {
  const urls = INDEXABLE_ROUTES.map((r) => {
    const loc = canonicalFor(r.path);
    return [
      "  <url>",
      `    <loc>${loc}</loc>`,
      `    <lastmod>${buildDate}</lastmod>`,
      `    <changefreq>${r.changefreq ?? "monthly"}</changefreq>`,
      `    <priority>${(r.priority ?? 0.5).toFixed(1)}</priority>`,
      "  </url>",
    ].join("\n");
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
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

      fs.writeFileSync(
        path.join(outDir, "sitemap.xml"),
        renderSitemap(buildDate),
      );
      this.info(
        `seo-prerender: wrote ${INDEXABLE_ROUTES.length} prerendered route(s) + sitemap.xml`,
      );
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss(), seoPrerender()],
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
          if (!id.includes("node_modules")) return;
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
