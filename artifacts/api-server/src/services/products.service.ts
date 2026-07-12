// Shop product use-cases, independent of HTTP. Groups the flat inventory
// variants into cards: rows sharing a `Website Group` become one card with
// selectable variants; ungrouped rows become standalone single-variant cards.

import { listVariants } from "../lib/notion/products.repository.js";
import type {
  ProductRecord,
  ProductVariantRecord,
  VariantRecord,
} from "../lib/notion/products.schema.js";

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "group"
  );
}

function toVariantRecord(variant: VariantRecord): ProductVariantRecord {
  const { category: _category, group: _group, ...rest } = variant;
  return rest;
}

/**
 * Group flat inventory variants into shop cards. Pure (no I/O) so it can be
 * unit-tested directly. Rows sharing a `Website Group` merge into one card
 * (first-seen order preserved); ungrouped rows become standalone cards.
 */
export function groupVariants(variants: VariantRecord[]): ProductRecord[] {
  const cards: ProductRecord[] = [];
  // Grouped cards, keyed by the group value; preserves first-seen order.
  const groups = new Map<string, ProductRecord>();

  for (const variant of variants) {
    if (variant.group) {
      let card = groups.get(variant.group);
      if (!card) {
        card = {
          id: `group-${slugify(variant.group)}`,
          title: variant.group,
          category: variant.category,
          variants: [],
        };
        groups.set(variant.group, card);
        cards.push(card);
      }
      card.variants.push(toVariantRecord(variant));
    } else {
      cards.push({
        id: variant.id,
        title: variant.name,
        category: variant.category,
        variants: [toVariantRecord(variant)],
      });
    }
  }

  return cards;
}

export async function getProducts(): Promise<ProductRecord[]> {
  return groupVariants(await listVariants());
}
