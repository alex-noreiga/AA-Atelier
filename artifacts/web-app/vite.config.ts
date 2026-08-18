import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "path";
import { INDEXABLE_ROUTES } from "./src/lib/seo-routes";
import { renderRouteHtml, renderSitemap } from "./src/lib/seo-html";

const port = process.env.PORT ? Number(process.env.PORT) : 5173;
const basePath = process.env.BASE_PATH ?? "/";

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
        renderSitemap(INDEXABLE_ROUTES, buildDate),
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
