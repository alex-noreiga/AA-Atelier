import type { InvoiceLineItem } from "@workspace/api-client-react";

// Line types in the order they read on the invoice, with their display heading.
// Unknown types (should the atelier add one) fall through under their raw name.
// Shared by the on-screen invoice (`pages/invoice.tsx`) and the downloadable PDF
// (`lib/pdf/invoice-pdf.ts`) so the two can't group or order the lines differently.
export const TYPE_HEADINGS: Record<string, string> = {
  // A whole job quoted as one figure — a repair, a stoning job, an alteration
  // (the studio dashboard's "Quote a flat price"). Headed "Work" rather than
  // "Service" because it sits above the atelier's own description of the job
  // ("Re-stone bodice"), which reads as the work itself, not a category.
  Service: "Work",
  Garment: "Garment",
  Material: "Materials",
  Labor: "Labor",
  Adjustment: "Adjustments",
  // A rush order's surcharge (or any atelier-added surcharge), shown last so it
  // reads as an addition on top of the itemized garment. The atelier adds it as
  // a "Surcharge" line on the invoice; it flows into the balance like any line.
  Surcharge: "Surcharge",
};
export const TYPE_ORDER = [
  // First: on a flat-quoted invoice this is the whole charge, and on any other
  // it would be the headline item.
  "Service",
  "Garment",
  "Material",
  "Labor",
  "Adjustment",
  "Surcharge",
];

export interface LineItemGroup {
  type: string;
  heading: string;
  items: InvoiceLineItem[];
}

/** Group line items by type, preferred types first, preserving item order. */
export function groupLineItems(lineItems: InvoiceLineItem[]): LineItemGroup[] {
  const byType = new Map<string, InvoiceLineItem[]>();
  for (const item of lineItems) {
    const bucket = byType.get(item.type) ?? [];
    bucket.push(item);
    byType.set(item.type, bucket);
  }
  const orderedTypes = [
    ...TYPE_ORDER.filter((t) => byType.has(t)),
    ...[...byType.keys()].filter((t) => !TYPE_ORDER.includes(t)),
  ];
  return orderedTypes.map((type) => ({
    type,
    heading: TYPE_HEADINGS[type] ?? type,
    items: byType.get(type) ?? [],
  }));
}
