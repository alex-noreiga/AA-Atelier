import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  /** The small uppercase kicker above the heading. */
  eyebrow: string;
  /** The section `h2`. */
  title: string;
  className?: string;
}

/**
 * The centered "eyebrow + h2" section header used to introduce mid-page
 * sections (the process, story, and FAQ blocks). Shared so the tracking,
 * sizes, and spacing can't drift between pages.
 */
export function SectionHeader({ eyebrow, title, className }: SectionHeaderProps) {
  return (
    <div className={cn("text-center mb-12", className)}>
      <p className="text-primary text-xs tracking-[0.35em] uppercase mb-4">
        {eyebrow}
      </p>
      <h2 className="font-serif text-3xl md:text-4xl text-foreground">{title}</h2>
    </div>
  );
}
