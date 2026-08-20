// Export the shop catalogue to a JSON file for build-time SEO prerendering.
//
// WHY: `/shop/:productId` is a dynamic route, so it can't be listed in
// `seo-routes.ts` and the web-app build has no way to know what products exist.
// Without this, a social scraper hitting a product URL falls through Vercel's
// SPA rewrite to the home page's `index.html` — so pinning a dress produced a
// card titled "Custom Figure Skating & Dance Costumes". This writes the same
// payload `GET /api/products` returns, and the web-app's `seo-prerender` plugin
// bakes a real per-product page from it.
//
//   pnpm --filter @workspace/api-server seo:export-products [outFile]
//
// It is DEGRADE-SAFE and never fails a build: if Notion isn't configured or the
// query fails, it logs, writes nothing, and exits 0 — the prerender pass then
// simply skips products, which is exactly the behaviour before this existed.
// Consequence to know about: the baked pages are a snapshot. A product added in
// Notion after a deploy has no prerendered page (it falls back to the SPA, as
// before) and one removed keeps a stale page until the next deploy. The SPA
// itself always renders live inventory; only the share card is frozen.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { getProducts } from "../services/products.service.js";

// Load a repo-root .env for local runs; a no-op on Vercel where env is injected.
config({ path: path.resolve(import.meta.dirname, "../../../../.env") });

const DEFAULT_OUT = path.resolve(
  import.meta.dirname,
  "../../../web-app/.seo/products.json",
);

async function main(): Promise<void> {
  const outFile = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUT;

  if (
    !process.env.NOTION_API_KEY ||
    !process.env.NOTION_INVENTORY_DATABASE_ID
  ) {
    console.warn(
      "[seo:export-products] Notion is not configured; skipping product prerender data.",
    );
    return;
  }

  const { products } = await getProducts();
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify({ products }, null, 2));
  console.log(
    `[seo:export-products] wrote ${products.length} product(s) to ${outFile}`,
  );
}

main().catch((err) => {
  // A shop outage must not take the whole deploy down: the site still builds,
  // it just ships without prerendered product pages this time round.
  console.warn(
    "[seo:export-products] could not read the catalogue; skipping product prerender data.",
    err instanceof Error ? err.message : err,
  );
});
