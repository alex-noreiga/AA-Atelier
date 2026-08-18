/**
 * Generate the per-route social share images under `public/social/`.
 *
 * Why this exists: social platforms crop a share image to their own aspect
 * ratio, and the two that matter here disagree. Facebook / LinkedIn / Slack
 * want landscape (1.91:1); Pinterest's feed is vertical (2:3) and renders a
 * landscape image as a small, easily-scrolled-past sliver. So every route gets
 * BOTH, emitted as an ordered `og:image` pair (see `seo-routes.ts`).
 *
 * This is an out-of-band tool, like `db:migrate` — it is NOT part of the build
 * or the deploy path. Run it when the art or the copy changes and commit the
 * PNGs it writes:
 *
 *     pnpm --filter @workspace/web-app run social-images
 *
 * It needs a Chromium binary (set `CHROMIUM_PATH`, or let it find Playwright's)
 * and network access to fetch the two brand fonts from Google Fonts. Fonts are
 * cached in the system temp dir between runs.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  INDEXABLE_ROUTES,
  socialSlug,
  SOCIAL_IMAGE_SIZES,
} from "../src/lib/seo-routes.ts";

// ── Brand tokens, mirroring `src/index.css` ──────────────────────────────────
const PLUM = "#281522"; // --background: 320 30% 12%
const PLUM_LIFT = "#3a1f31"; // a touch lighter, for the radial lift
const CHAMPAGNE = "#f4ece0"; // --foreground: 35 40% 92%
const ROSE = "#c8919a"; // --primary: 355 35% 65%
const MUTED = "#cfc0b4"; // --muted-foreground: 35 20% 75%

/**
 * The display copy for each route's artwork.
 *
 * Deliberately NOT the SEO title/description: those are written for search
 * results (long, keyword-bearing) and read as clutter at poster scale. Keyed by
 * route path; the run fails if an indexable route has no entry, so adding a
 * route can't silently ship a blank card.
 */
const ART: Record<string, { headline: string; subline: string }> = {
  "/": {
    headline: "Custom costumes,\nmade to measure",
    subline:
      "Figure skating & dance, handcrafted from first sketch to final stitch.",
  },
  "/services": {
    headline: "Bespoke commissions\n& fittings",
    subline:
      "Custom builds, alterations, hand-applied rhinestoning, and repairs.",
  },
  "/about": {
    headline: "The atelier\nbehind the ice",
    subline: "Meet A.A Atelier — our timelines, measuring, and pricing.",
  },
  "/shop": {
    headline: "Ready to wear",
    subline: "In-stock figure skating and dance pieces, ready to ship.",
  },
  "/order": {
    headline: "Begin your\ncommission",
    subline:
      "Share your measurements and design notes to start a custom piece.",
  },
  "/appointments": {
    headline: "Book a fitting\nor consultation",
    subline: "Choose a time that suits you and book online in a few steps.",
  },
  "/contact": {
    headline: "Say hello",
    subline: "Questions about a custom costume, a fitting, or a repair.",
  },
  "/privacy": {
    headline: "Privacy policy",
    subline: "How A.A Atelier handles your personal information.",
  },
  "/terms": {
    headline: "Terms of service",
    subline:
      "The terms covering orders, deposits, appointments, and purchases.",
  },
  "/shipping-returns": {
    headline: "Shipping\n& returns",
    subline: "Delivery timelines, and the return policy for custom garments.",
  },
};

// ── Fonts ───────────────────────────────────────────────────────────────────
const FONT_CACHE = path.join(os.tmpdir(), "aa-atelier-social-fonts");

/** The Google Fonts CSS API serves plain TTF to an old user-agent string. */
const FONT_CSS = {
  serif:
    "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&display=swap",
  sans: "https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500&display=swap",
};

async function fetchFont(name: string, cssUrl: string): Promise<string[]> {
  fs.mkdirSync(FONT_CACHE, { recursive: true });
  const cached = path.join(FONT_CACHE, `${name}.json`);
  if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, "utf8"));

  const css = await fetch(cssUrl, {
    headers: { "User-Agent": "Mozilla/4.0" },
  }).then((r) => r.text());
  const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)]+/g))];
  if (urls.length === 0) throw new Error(`No font files found for ${name}`);

  const files = await Promise.all(
    urls.map(async (u) => {
      const buf = Buffer.from(await (await fetch(u)).arrayBuffer());
      return buf.toString("base64");
    }),
  );
  fs.writeFileSync(cached, JSON.stringify(files));
  return files;
}

/** `@font-face` rules with the font bytes inlined, so Chromium needs no network. */
function fontFaces(family: string, weights: number[], files: string[]): string {
  return files
    .map(
      (b64, i) => `@font-face {
  font-family: "${family}";
  font-weight: ${weights[i] ?? 400};
  font-style: normal;
  src: url(data:font/ttf;base64,${b64}) format("truetype");
}`,
    )
    .join("\n");
}

// ── Page template ───────────────────────────────────────────────────────────
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Render the headline's newlines as real line breaks. */
function headlineHtml(headline: string) {
  return headline.split("\n").map(escapeHtml).join("<br />");
}

interface Layout {
  width: number;
  height: number;
  /** Base type scale — the tall format carries larger type at the same width. */
  headline: number;
  eyebrow: number;
  subline: number;
  footer: number;
  padding: number;
}

const LAYOUTS: Record<"og" | "pin", Layout> = {
  og: {
    width: SOCIAL_IMAGE_SIZES.og.width,
    height: SOCIAL_IMAGE_SIZES.og.height,
    headline: 76,
    eyebrow: 19,
    subline: 25,
    footer: 19,
    padding: 84,
  },
  pin: {
    width: SOCIAL_IMAGE_SIZES.pin.width,
    height: SOCIAL_IMAGE_SIZES.pin.height,
    headline: 84,
    eyebrow: 21,
    subline: 29,
    footer: 21,
    padding: 92,
  },
};

function pageHtml(
  art: { headline: string; subline: string },
  layout: Layout,
  faces: string,
): string {
  return `<!doctype html>
<html><head><meta charset="utf-8" /><style>
${faces}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${layout.width}px; height: ${layout.height}px; }
body {
  background: ${PLUM};
  color: ${CHAMPAGNE};
  font-family: "Jost", sans-serif;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
}
.frame {
  position: relative;
  width: 100%;
  height: 100%;
  padding: ${layout.padding}px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  /* A soft rose-gold lift from the upper left, echoing the site's --glow-primary. */
  background:
    radial-gradient(120% 90% at 12% 0%, ${PLUM_LIFT} 0%, ${PLUM} 62%);
}
/* Inset champagne hairline — the editorial frame the site uses on cards. */
.rule-frame {
  position: absolute;
  inset: ${Math.round(layout.padding * 0.42)}px;
  border: 1px solid rgba(244, 236, 224, 0.22);
  pointer-events: none;
}
.eyebrow {
  font-size: ${layout.eyebrow}px;
  font-weight: 400;
  letter-spacing: 0.42em;
  text-transform: uppercase;
  color: ${ROSE};
}
.middle { display: flex; flex-direction: column; gap: ${Math.round(layout.subline * 1.5)}px; }
h1 {
  font-family: "Cormorant Garamond", serif;
  font-weight: 300;
  font-size: ${layout.headline}px;
  line-height: 1.08;
  letter-spacing: 0.005em;
}
.hair {
  width: ${Math.round(layout.headline * 1.1)}px;
  height: 1px;
  background: ${ROSE};
  opacity: 0.85;
}
.subline {
  font-size: ${layout.subline}px;
  font-weight: 300;
  line-height: 1.5;
  color: ${MUTED};
  max-width: ${Math.round(layout.width * 0.78)}px;
}
.footer {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: ${layout.footer}px;
  font-weight: 400;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: rgba(244, 236, 224, 0.72);
}
</style></head><body>
  <div class="frame">
    <div class="rule-frame"></div>
    <div class="eyebrow">A3 Ice and Dance</div>
    <div class="middle">
      <h1>${headlineHtml(art.headline)}</h1>
      <div class="hair"></div>
      <p class="subline">${escapeHtml(art.subline)}</p>
    </div>
    <div class="footer">
      <span>A.A Atelier</span>
      <span>a3iceanddance.com</span>
    </div>
  </div>
</body></html>`;
}

// ── Chromium ────────────────────────────────────────────────────────────────
/**
 * Find a browser binary, preferring Playwright's `headless_shell`.
 *
 * The preference is load-bearing, not incidental: with a full Chrome binary
 * `--window-size` sizes the OS *window*, so the render viewport comes out ~90px
 * shorter and the bottom of the artwork is clipped out of the capture.
 * `headless_shell` has no window chrome, so window size == viewport size and
 * the capture is exact. If you must point `CHROMIUM_PATH` at a full Chrome,
 * check the output: a missing bottom rule means you hit this.
 */
function findChromium(): string {
  const candidates = [process.env.CHROMIUM_PATH].filter((c): c is string =>
    Boolean(c),
  );

  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (browsersRoot && fs.existsSync(browsersRoot)) {
    const dirs = fs.readdirSync(browsersRoot);
    for (const dir of dirs.filter((d) =>
      d.startsWith("chromium_headless_shell"),
    ))
      candidates.push(
        path.join(browsersRoot, dir, "chrome-linux", "headless_shell"),
      );
    for (const dir of dirs.filter((d) => d.startsWith("chromium-")))
      candidates.push(path.join(browsersRoot, dir, "chrome-linux", "chrome"));
  }

  candidates.push(
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  );

  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  throw new Error(
    "No Chromium found. Install Playwright's browsers (`npx playwright install chromium`) " +
      "or set CHROMIUM_PATH to a Chrome/Chromium binary.",
  );
}

function screenshot(
  chromium: string,
  html: string,
  layout: Layout,
  outFile: string,
) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aa-social-"));
  try {
    const page = path.join(tmp, "page.html");
    fs.writeFileSync(page, html);
    // `headless_shell` is always headless; a full Chrome needs to be told.
    const headlessFlag = chromium.endsWith("headless_shell")
      ? []
      : ["--headless=new"];
    execFileSync(
      chromium,
      [
        ...headlessFlag,
        "--disable-gpu",
        "--no-sandbox",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        `--window-size=${layout.width},${layout.height}`,
        // Give the inlined fonts a moment to load before the frame is captured.
        "--virtual-time-budget=3000",
        `--user-data-dir=${path.join(tmp, "profile")}`,
        `--screenshot=${outFile}`,
        `file://${page}`,
      ],
      { stdio: "pipe" },
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const missing = INDEXABLE_ROUTES.filter((r) => !ART[r.path]).map(
    (r) => r.path,
  );
  if (missing.length > 0) {
    throw new Error(
      `No social art copy for: ${missing.join(", ")}. Add an ART entry for each.`,
    );
  }

  const chromium = findChromium();
  const [serif, sans] = await Promise.all([
    fetchFont("cormorant", FONT_CSS.serif),
    fetchFont("jost", FONT_CSS.sans),
  ]);
  const faces = [
    fontFaces("Cormorant Garamond", [300, 400, 600], serif),
    fontFaces("Jost", [300, 400, 500], sans),
  ].join("\n");

  const outDir = path.resolve(import.meta.dirname, "../public/social");
  fs.mkdirSync(outDir, { recursive: true });

  for (const route of INDEXABLE_ROUTES) {
    const art = ART[route.path]!;
    const slug = socialSlug(route.path);
    for (const format of ["og", "pin"] as const) {
      const layout = LAYOUTS[format];
      const outFile = path.join(outDir, `${slug}-${format}.png`);
      screenshot(chromium, pageHtml(art, layout, faces), layout, outFile);
      const kb = Math.round(fs.statSync(outFile).size / 1024);
      console.log(
        `  ${slug}-${format}.png  ${layout.width}x${layout.height}  ${kb} kB`,
      );
    }
  }
  console.log(`\nWrote ${INDEXABLE_ROUTES.length * 2} images to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
