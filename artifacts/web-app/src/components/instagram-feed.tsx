import { useState } from "react";
import { Instagram, Layers, Play } from "lucide-react";
import { Link } from "wouter";
import {
  useGetInstagramFeed,
  type InstagramPost,
} from "@workspace/api-client-react";
import { SectionHeader } from "@/components/section-header";
import { INSTAGRAM_HANDLE, INSTAGRAM_URL } from "@/lib/contact-info";
import { ctaVariants } from "@/components/cta";
import { cn } from "@/lib/utils";

/** How many tiles a strip shows when the caller doesn't say. Six fills two rows
 * of three without the section growing into a page of its own. */
const DEFAULT_LIMIT = 6;

/**
 * A tile's alternative text.
 *
 * The first line of the caption, because an Instagram caption is a headline
 * followed by a paragraph and a wall of hashtags, and a screen reader given all
 * of it reads the hashtags too. Falls back to naming the studio rather than
 * leaving `alt` empty: these are photographs of the work, not decoration.
 */
export function postAltText(post: Pick<InstagramPost, "caption">): string {
  const firstLine = (post.caption ?? "").split("\n")[0].trim();
  if (!firstLine) return "A recent piece from the A.A Atelier studio";
  return firstLine.length > 140 ? `${firstLine.slice(0, 139)}…` : firstLine;
}

/** A play or stack glyph in the tile's corner, so a video or a multi-photo post
 * reads as one before it's clicked — the same affordance Instagram's own grid
 * gives. A plain photo gets nothing. */
function MediaBadge({ mediaType }: { mediaType: InstagramPost["mediaType"] }) {
  if (mediaType === "image") return null;
  const Icon = mediaType === "video" ? Play : Layers;
  return (
    <span
      className="absolute right-2 top-2 rounded-full bg-background/70 p-1.5 text-foreground backdrop-blur-sm"
      aria-hidden="true"
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
    </span>
  );
}

interface TileProps {
  post: InstagramPost;
  onImageError: (id: string) => void;
}

function Tile({ post, onImageError }: TileProps) {
  return (
    <li className="relative" data-testid="instagram-post">
      {/* The photograph links out to Instagram. The shop link below is a
          SIBLING, not a child: an anchor inside an anchor is invalid markup and
          leaves the inner link unreachable by keyboard in some browsers. */}
      <a
        href={post.permalink}
        target="_blank"
        rel="noreferrer"
        className="group block aspect-square overflow-hidden rounded-xl border border-border/60"
        data-testid="instagram-post-link"
      >
        <img
          src={post.imageUrl}
          alt={postAltText(post)}
          loading="lazy"
          onError={() => onImageError(post.id)}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <MediaBadge mediaType={post.mediaType} />
      </a>

      {post.productId && (
        <Link
          to={`/shop/${post.productId}`}
          className="absolute inset-x-2 bottom-2 truncate rounded-full bg-background/90 px-4 py-2 text-center text-[0.65rem] uppercase tracking-widest text-foreground backdrop-blur-sm transition-colors hover:text-primary"
          data-testid="instagram-post-shop"
        >
          Shop {post.productTitle}
        </Link>
      )}
    </li>
  );
}

interface InstagramFeedProps {
  /** The section's kicker — lets each page introduce the strip in its own voice. */
  eyebrow?: string;
  /** The section heading. */
  title?: string;
  /** How many tiles to show. */
  limit?: number;
  className?: string;
}

/**
 * The studio's recent Instagram posts, shown on the home and shop pages.
 *
 * Renders **nothing at all** while loading, on error, or when there is nothing
 * to show — the same contract as `<Testimonials />`, and for the same reason.
 * This is social proof garnishing pages that must stand on their own, so an
 * empty state ("no posts yet") or a loading skeleton would advertise the
 * absence, and an Instagram outage would leave a hole mid-page. The server
 * makes the same choice on its side: an unconfigured integration and a failed
 * read both answer with an empty list.
 *
 * A tile whose image fails to load is dropped rather than left as a broken
 * square. Instagram's CDN URLs are signed and do eventually expire, and a grid
 * of the atelier's work is the last place a broken-image icon should appear.
 */
export function InstagramFeed({
  eyebrow = "From the Studio",
  title = "Follow along",
  limit = DEFAULT_LIMIT,
  className = "mt-24",
}: InstagramFeedProps) {
  const { data } = useGetInstagramFeed();
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());

  const posts = (data?.posts ?? [])
    .filter((post) => !broken.has(post.id))
    .slice(0, limit);

  if (posts.length === 0) return null;

  const markBroken = (id: string) =>
    setBroken((current) => new Set(current).add(id));

  return (
    <section className={className} data-testid="instagram-feed">
      <SectionHeader eyebrow={eyebrow} title={title} />
      <ul
        className={cn(
          "grid grid-cols-2 gap-3 sm:gap-4",
          posts.length > 2 && "sm:grid-cols-3",
        )}
      >
        {posts.map((post) => (
          <Tile key={post.id} post={post} onImageError={markBroken} />
        ))}
      </ul>
      <div className="mt-10 text-center">
        <a
          href={INSTAGRAM_URL}
          target="_blank"
          rel="noreferrer"
          className={cn(ctaVariants({ variant: "outline" }))}
          data-testid="instagram-profile-link"
        >
          <Instagram className="h-4 w-4" strokeWidth={1.5} />
          {INSTAGRAM_HANDLE}
        </a>
      </div>
    </section>
  );
}
