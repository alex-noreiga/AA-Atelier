// The social-proof strip: the studio's recent Instagram posts, each carrying
// the shop piece it shows when the atelier has said which one that is.
//
// The join is the whole point of the card. A feed of pretty squares is
// decoration; a feed where the soaker in the photograph is one tap from the
// cart is the thing that pays for itself. What makes it honest is WHERE the
// link comes from: the atelier pastes the post's URL onto the inventory row it
// photographed, so every "Shop this piece" is a statement they made, not an
// inference this code drew from a caption.
//
// Both halves degrade independently, and neither can take the other down: no
// Instagram ⇒ no strip at all; no shop ⇒ a strip of posts that link to
// Instagram. That asymmetry is deliberate. The posts are the feature and the
// shop link is the upsell, so an inventory read that fails must cost the upsell
// rather than the section.

import { listInstagramPosts } from "../lib/instagram/media.repository.js";
import { instagramShortcode } from "../lib/instagram/schema.js";
import type { InstagramPostRecord } from "../lib/instagram/schema.js";
import { listVariants } from "../lib/notion/products.repository.js";
import type { VariantRecord } from "../lib/notion/products.schema.js";
import { logger } from "../lib/logger.js";
import { shopCardId } from "./products.service.js";

/** One post as the contract serves it — a post plus, sometimes, its piece. */
export interface InstagramFeedPost extends InstagramPostRecord {
  productId?: string;
  productTitle?: string;
}

export interface InstagramFeedView {
  posts: InstagramFeedPost[];
}

/** What a post links to in the shop. */
interface ShoppablePiece {
  productId: string;
  productTitle: string;
}

/**
 * Index the pieces the atelier has tied to a post, keyed by shortcode.
 *
 * Pure, so the matching rules below are unit-testable without Notion:
 *
 *   * A row whose `Instagram Post` is blank or isn't a post URL contributes
 *     nothing — it is simply a piece no post points at.
 *   * The **first** row wins when two name the same post. A group photograph
 *     legitimately shows several pieces, and there is one link to give; taking
 *     the first keeps the answer stable across reads (Notion's order is stable)
 *     rather than letting it flip between two equally-good candidates.
 *   * The link goes to the piece's shop CARD (`shopCardId`), not its row, since
 *     that is what `/shop/:productId` addresses — while the label is the row's
 *     own name, because a grouped card is titled with the group ("Skate
 *     Soakers") and the post shows one particular colourway.
 *
 * Sold-out pieces are deliberately kept: the shop still has a card for one,
 * showing it as sold out with a back-in-stock request, and sending an
 * interested visitor there is better than sending them to Instagram.
 */
export function indexShoppablePosts(
  variants: VariantRecord[],
): Map<string, ShoppablePiece> {
  const byShortcode = new Map<string, ShoppablePiece>();
  for (const variant of variants) {
    const shortcode = instagramShortcode(variant.instagramPostUrl);
    if (!shortcode || byShortcode.has(shortcode)) continue;
    byShortcode.set(shortcode, {
      productId: shopCardId(variant),
      productTitle: variant.name,
    });
  }
  return byShortcode;
}

/**
 * Attach each post's piece, where there is one. Pure.
 *
 * A post whose shortcode can't be read from its own permalink simply carries no
 * piece — the same outcome as no match, and the same safe direction.
 */
export function attachShoppablePieces(
  posts: InstagramPostRecord[],
  byShortcode: Map<string, ShoppablePiece>,
): InstagramFeedPost[] {
  return posts.map((post) => {
    const shortcode = instagramShortcode(post.permalink);
    const piece = shortcode ? byShortcode.get(shortcode) : undefined;
    return piece ? { ...post, ...piece } : post;
  });
}

/**
 * The strip's posts, newest first, each with its shop piece where the atelier
 * has recorded one.
 *
 * Never throws. The posts read already degrades to an empty list (see
 * `media.repository.ts`), and the inventory read — which does throw, for an
 * unconfigured database or a Notion outage — is caught here rather than
 * propagated: this endpoint's failure mode is a shorter answer, never a 500 on
 * the home page.
 */
export async function getInstagramFeed(): Promise<InstagramFeedView> {
  const posts = await listInstagramPosts();
  if (posts.length === 0) return { posts: [] };

  let variants: VariantRecord[] = [];
  try {
    variants = await listVariants();
  } catch (err) {
    // Warn rather than alert: the strip still renders, and the shop's own
    // endpoint will have raised the same failure where it actually matters.
    logger.warn(
      { err },
      "Could not read inventory to link Instagram posts to shop pieces; serving the feed unlinked",
    );
  }

  return { posts: attachShoppablePieces(posts, indexShoppablePosts(variants)) };
}
