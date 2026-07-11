import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center p-6 pt-24 bg-background text-center">
      <p className="text-primary text-xs tracking-[0.35em] uppercase mb-6">
        404
      </p>
      <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-4">
        Page not found
      </h1>
      <p className="text-muted-foreground font-light text-lg max-w-md mb-10">
        The page you're looking for doesn't exist or may have moved.
      </p>
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-sm tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors group"
        data-testid="link-home"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        Back to home
      </Link>
    </div>
  );
}
