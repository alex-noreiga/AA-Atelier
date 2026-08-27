// Shop product use-cases, independent of HTTP. Groups the flat inventory
// variants into cards: rows sharing a `Website Group` become one card with
// selectable variants; ungrouped rows become standalone single-variant cards.

import { listVariants } from "../lib/notion/products.repository.js";
import { listCategoryRecords } from "../lib/notion/product-categories.repository.js";
import { listPublishedProductReviews } from "../lib/notion/reviews.repository.js";
import { summarizeProductRatings } from "./product-ratings.js";
import { logger } from "../lib/logger.js";
import type { CategoryRecord } from "../lib/notion/product-categories.schema.js";
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

/**
 * The shop card id a variant lands on — `group-<slug>` when it belongs to a
 * `Website Group`, otherwise its own Notion page id. This is what `/shop/:productId`
 * addresses, so it's exported for the restock alert's deep link: the two must
 * agree or the email links to a card that doesn't exist.
 */
export function shopCardId(
  variant: Pick<VariantRecord, "id" | "group">,
): string {
  return variant.group ? `group-${slugify(variant.group)}` : variant.id;
}

function toVariantRecord(variant: VariantRecord): ProductVariantRecord {
  const {
    category: _category,
    categoryId: _categoryId,
    group: _group,
    addOnIds,
    ...rest
  } = variant;
  // Omit the add-ons array entirely when empty so the payload only carries it
  // for variants that actually have a matching add-on.
  return addOnIds.length > 0 ? { ...rest, addOnIds } : rest;
}

/**
 * The size-guide fields for a card in `category`. A soaker category (in
 * `soakerCategories`) always shows its blade-length chart — its size guide is
 * implied by the type, so it needn't also be in `sizedCategories`. Otherwise the
 * card is sized only if its category shows the ready-to-wear chart, and carries
 * no `sizeGuide` (the client treats absent as "garment").
 */
function sizeGuideFields(
  category: string,
  sizedCategories: ReadonlySet<string>,
  soakerCategories: ReadonlySet<string>,
): { sized: boolean; sizeGuide?: "soaker" } {
  if (soakerCategories.has(category))
    return { sized: true, sizeGuide: "soaker" };
  return { sized: sizedCategories.has(category) };
}

/**
 * Group flat inventory variants into shop cards. Pure (no I/O) so it can be
 * unit-tested directly. Rows sharing a `Website Group` merge into one card
 * (first-seen order preserved); ungrouped rows become standalone cards.
 *
 * A card's size-guide fields (does its category show a chart, and which one) are
 * looked up by the card's category from `sizedCategories` (ready-to-wear chart)
 * and `soakerCategories` (skate-soaker blade chart) — the caller passes the live
 * sets from the "Product Categories" database.
 */
export function groupVariants(
  variants: VariantRecord[],
  sizedCategories: ReadonlySet<string> = new Set(),
  soakerCategories: ReadonlySet<string> = new Set(),
): ProductRecord[] {
  const cards: ProductRecord[] = [];
  // Grouped cards, keyed by the group value; preserves first-seen order.
  const groups = new Map<string, ProductRecord>();

  for (const variant of variants) {
    if (variant.group) {
      let card = groups.get(variant.group);
      if (!card) {
        card = {
          id: shopCardId(variant),
          title: variant.group,
          category: variant.category,
          ...sizeGuideFields(
            variant.category,
            sizedCategories,
            soakerCategories,
          ),
          variants: [],
        };
        groups.set(variant.group, card);
        cards.push(card);
      }
      card.variants.push(toVariantRecord(variant));
    } else {
      cards.push({
        id: shopCardId(variant),
        title: variant.name,
        category: variant.category,
        ...sizeGuideFields(variant.category, sizedCategories, soakerCategories),
        variants: [toVariantRecord(variant)],
      });
    }
  }

  return cards;
}

/**
 * Narrow the live category options to those that actually have a card on the
 * shop, preserving Notion's ordering. Pure, so it can be unit-tested directly.
 * An option the team has defined but not yet stocked would otherwise render a
 * filter chip that leads to an empty grid.
 */
export function visibleCategories(
  categories: string[],
  products: ProductRecord[],
): string[] {
  const stocked = new Set(products.map((product) => product.category));
  return categories.filter((category) => stocked.has(category));
}

/**
 * Build the shop payload from the Product Categories records (the configured
 * path). Each variant's category + sized flag is resolved from its `Category`
 * relation via the record's page id; a variant with no link keeps its raw
 * (blank) category. The chip list is the category names ordered by `Sort`,
 * narrowed to those actually stocked. Pure, so it's unit-testable directly.
 */
export function resolveFromCategories(
  variants: VariantRecord[],
  records: CategoryRecord[],
): { products: ProductRecord[]; categories: string[] } {
  const byId = new Map(records.map((record) => [record.id, record]));
  // Resolve the authoritative category name from the relation; keep the raw
  // (blank) category when a row isn't linked (or its category was deleted).
  const resolved = variants.map((variant) => {
    const record = variant.categoryId
      ? byId.get(variant.categoryId)
      : undefined;
    return record ? { ...variant, category: record.name } : variant;
  });
  const sizedCategories = new Set(
    records.filter((record) => record.sized).map((record) => record.name),
  );
  const soakerCategories = new Set(
    records
      .filter((record) => record.sizeGuide === "soaker")
      .map((record) => record.name),
  );
  const products = groupVariants(resolved, sizedCategories, soakerCategories);
  const orderedNames = [...records]
    .sort((a, b) => (a.sort ?? Infinity) - (b.sort ?? Infinity))
    .map((record) => record.name);

  return { products, categories: visibleCategories(orderedNames, products) };
}

/**
 * Resolve inventory page ids to the names the shop lists them under.
 *
 * Used where an order's `Inventory Items` relation has to be said out loud —
 * the pieces on a delivered shop order, and the piece a review names. Reads the
 * same 60s-cached inventory the shop does, and is **best-effort**: a Notion
 * blip, or a piece the atelier has since unpublished, yields no entry rather
 * than an error, because in both callers the name is a label on something that
 * works without it.
 */
export async function findVariantNames(
  ids: string[],
): Promise<Map<string, string>> {
  const wanted = new Set(ids);
  if (wanted.size === 0) return new Map();

  try {
    const variants = await listVariants();
    return new Map(
      variants
        .filter((variant) => wanted.has(variant.id) && variant.name)
        .map((variant) => [variant.id, variant.name]),
    );
  } catch (err) {
    logger.warn({ err }, "Could not resolve inventory names for an order");
    return new Map();
  }
}

export async function getProducts(): Promise<{
  products: ProductRecord[];
  categories: string[];
}> {
  const [variants, records] = await Promise.all([
    listVariants(),
    listCategoryRecords(),
  ]);

  // The "Product Categories" database is the shop's sole source for the category
  // list + size-guide flag. `null` means its env var is unset — fail loud rather
  // than silently empty the shop, since there is no longer a fallback source.
  if (!records) {
    throw new Error(
      "NOTION_PRODUCT_CATEGORIES_DATABASE_ID is not configured for the shop category source",
    );
  }

  const resolved = resolveFromCategories(variants, records);
  return {
    ...resolved,
    products: await withRatings(resolved.products, variants),
  };
}

/**
 * Attach each card's customer rating, where it has one.
 *
 * **Best-effort, and deliberately the last thing that happens.** A rating is
 * something extra beside a piece; the piece itself is the shop. So an
 * unconfigured or unreachable reviews database costs the cards their stars and
 * nothing else — never the shop its stock, which is what a thrown error here
 * would mean. (`listPublishedProductReviews` already returns `[]` for an unset
 * database and falls back to its cache on a blip; this catch is the backstop for
 * a cold instance meeting a Notion outage.)
 */
async function withRatings(
  products: ProductRecord[],
  variants: VariantRecord[],
): Promise<ProductRecord[]> {
  let reviews;
  try {
    reviews = await listPublishedProductReviews();
  } catch (err) {
    logger.warn(
      { err },
      "Could not read shop reviews; serving without ratings",
    );
    return products;
  }
  if (reviews.length === 0) return products;

  // The join: a review names an inventory row, and this is the card that row
  // ended up on — the same `shopCardId` that decided the card's own id, so the
  // two can't disagree.
  const cardIdByVariant = new Map(
    variants.map((variant) => [variant.id, shopCardId(variant)]),
  );
  const summaries = summarizeProductRatings(products, reviews, (variantId) =>
    cardIdByVariant.get(variantId),
  );

  return products.map((product) => {
    const rating = summaries.get(product.id);
    return rating ? { ...product, rating } : product;
  });
}
