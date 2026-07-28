import type { InvoiceLineItem } from "@workspace/api-client-react";

// Line types in the order they read on the invoice, with their display heading.
// Unknown types (should the atelier add one) fall through under their raw name.
// Shared by the on-screen invoice (`pages/invoice.tsx`) and the downloadable PDF
// (`lib/pdf/invoice-pdf.ts`) so the two can't group or order the lines differently.
export const TYPE_HEADINGS: Record<string, string> = {
  Garment: "Garment",
  Material: "Materials",
  Labor: "Labor",
  Adjustment: "Adjustments",
};
export const TYPE_ORDER = ["Garment", "Material", "Labor", "Adjustment"];

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
