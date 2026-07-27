import { jsPDF } from "jspdf";
import { STUDIO_NAME, STUDIO_CONTACT_LINES } from "./studio";

type RGB = [number, number, number];

// The site palette, sampled for print. Documents stay mostly ink-on-white with a
// muted grey for secondary text and a single gold hairline under the wordmark, so
// they read as the same editorial system as the app without leaning on colour.
const INK: RGB = [25, 27, 34];
const MUTED: RGB = [92, 96, 112];
const FAINT: RGB = [138, 143, 158];
const LINE: RGB = [221, 223, 231];
const GOLD: RGB = [169, 139, 78];

// US Letter in points, with a generous margin. jsPDF's y-origin is the top edge;
// every text call here draws from its top baseline so `y` tracks the top of the
// next line and sections just stack downward.
const PAGE = { width: 612, height: 792, margin: 56 };
const AMOUNT_COL = 96; // reserved width for the right-aligned money column
const SERIF = "times";
const SANS = "helvetica";

/**
 * A thin, cursor-based layout helper over jsPDF for the studio's printed
 * documents (invoice + receipt). It owns the page geometry, the serif/sans
 * split, and the palette so the two documents read as one system; callers just
 * push sections down the page and the helper handles wrapping and page breaks.
 */
export class PdfDocument {
  readonly doc: jsPDF;
  private y = PAGE.margin;
  private readonly left = PAGE.margin;
  private readonly right = PAGE.width - PAGE.margin;
  private readonly bottom = PAGE.height - PAGE.margin;

  constructor() {
    this.doc = new jsPDF({ unit: "pt", format: "letter" });
  }

  private ink(c: RGB) {
    this.doc.setTextColor(c[0], c[1], c[2]);
  }

  private stroke(c: RGB) {
    this.doc.setDrawColor(c[0], c[1], c[2]);
  }

  /** Start a new page if the next block of height `h` wouldn't fit. */
  private ensureSpace(h: number) {
    if (this.y + h > this.bottom) {
      this.doc.addPage();
      this.y = PAGE.margin;
    }
  }

  private rule(color: RGB, weight = 0.75) {
    this.stroke(color);
    this.doc.setLineWidth(weight);
    this.doc.line(this.left, this.y, this.right, this.y);
  }

  private get center() {
    return (this.left + this.right) / 2;
  }

  /** Studio wordmark + contact line on the left; document label + meta on the right. */
  masthead(label: string, meta: string[]) {
    const top = this.y;

    this.doc.setFont(SERIF, "normal");
    this.doc.setFontSize(24);
    this.ink(INK);
    this.doc.text(STUDIO_NAME, this.left, top, { baseline: "top" });

    this.doc.setFont(SANS, "bold");
    this.doc.setFontSize(10);
    this.ink(MUTED);
    this.doc.text(label.toUpperCase(), this.right, top + 2, {
      align: "right",
      baseline: "top",
    });

    this.doc.setFont(SANS, "normal");
    this.doc.setFontSize(9);
    this.ink(FAINT);
    let metaY = top + 18;
    for (const line of meta) {
      this.doc.text(line, this.right, metaY, {
        align: "right",
        baseline: "top",
      });
      metaY += 12;
    }

    this.doc.setFontSize(8.5);
    this.ink(FAINT);
    this.doc.text(STUDIO_CONTACT_LINES.join("   ·   "), this.left, top + 32, {
      baseline: "top",
    });

    this.y = Math.max(metaY, top + 32 + 12) + 10;
    this.rule(GOLD, 1);
    this.y += 24;
  }

  /** A serif document title with an optional muted subtitle beneath it. */
  title(text: string, sub?: string) {
    this.ensureSpace(44);
    this.doc.setFont(SERIF, "normal");
    this.doc.setFontSize(18);
    this.ink(INK);
    this.doc.text(text, this.left, this.y, { baseline: "top" });
    this.y += 24;
    if (sub) {
      this.doc.setFont(SANS, "normal");
      this.doc.setFontSize(9.5);
      this.ink(MUTED);
      this.doc.text(sub, this.left, this.y, { baseline: "top" });
      this.y += 16;
    }
    this.y += 8;
  }

  /** A small, letter-spaced uppercase section heading (e.g. "Materials"). */
  sectionLabel(text: string) {
    this.ensureSpace(20);
    this.doc.setFont(SANS, "bold");
    this.doc.setFontSize(8);
    this.ink(FAINT);
    this.doc.setCharSpace(1.2);
    this.doc.text(text.toUpperCase(), this.left, this.y, { baseline: "top" });
    this.doc.setCharSpace(0);
    this.y += 16;
  }

  /** A label/amount line: name on the left (wrapping if long), amount right-aligned. */
  row(name: string, amount: string, opts: { muted?: boolean } = {}) {
    this.doc.setFont(SANS, "normal");
    this.doc.setFontSize(10);
    const maxNameWidth = this.right - this.left - AMOUNT_COL;
    const lines = this.doc.splitTextToSize(name, maxNameWidth) as string[];
    const height = lines.length * 13 + 3;
    this.ensureSpace(height);

    this.ink(opts.muted ? MUTED : INK);
    this.doc.text(lines, this.left, this.y, { baseline: "top" });
    this.ink(MUTED);
    this.doc.text(amount, this.right, this.y, {
      align: "right",
      baseline: "top",
    });
    this.y += height;
  }

  divider() {
    this.ensureSpace(20);
    this.y += 8;
    this.rule(LINE);
    this.y += 14;
  }

  /** The prominent serif totals line (Balance due / Total). */
  total(label: string, amount: string) {
    this.ensureSpace(30);
    this.y += 4;
    this.doc.setFont(SERIF, "normal");
    this.doc.setFontSize(14);
    this.ink(INK);
    this.doc.text(label, this.left, this.y, { baseline: "top" });
    this.doc.text(amount, this.right, this.y, {
      align: "right",
      baseline: "top",
    });
    this.y += 24;
  }

  /** A centered, letter-spaced note (e.g. a "Balance paid" stamp). */
  note(text: string) {
    this.ensureSpace(22);
    this.y += 8;
    this.doc.setFont(SANS, "bold");
    this.doc.setFontSize(9);
    this.ink(MUTED);
    this.doc.setCharSpace(1.2);
    this.doc.text(text.toUpperCase(), this.center, this.y, {
      align: "center",
      baseline: "top",
    });
    this.doc.setCharSpace(0);
    this.y += 18;
  }

  spacer(h = 8) {
    this.y += h;
  }

  /** Faint, centered footer lines pinned to the bottom of the current page. */
  footer(lines: string[]) {
    this.doc.setFont(SANS, "normal");
    this.doc.setFontSize(8);
    this.ink(FAINT);
    let fy = this.bottom;
    for (let i = lines.length - 1; i >= 0; i--) {
      this.doc.text(lines[i], this.center, fy, {
        align: "center",
        baseline: "bottom",
      });
      fy -= 12;
    }
  }

  save(filename: string) {
    this.doc.save(filename);
  }
}

/** Make a value safe to drop into a download filename. */
export function fileSafe(value: string): string {
  return value.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
}
